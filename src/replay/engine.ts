import type {
  CapabilityArtifact,
  CapabilityStep,
  InputDefinition,
  OutputDefinition,
} from "../artifacts/schema.js";
import { validateCapabilitySemantics } from "../artifacts/schema.js";
import {
  EvidenceLogger,
  type EvidenceLoggerLike,
  type EvidenceRun,
} from "../evidence/evidence-logger.js";
import { PolicyEngine, PolicyError } from "../policy/policy-engine.js";
import {
  AutomationError,
  AutomationErrorCode,
} from "../surface/automation-error.js";
import type { ReplaySurface } from "../surface/browser-surface.js";
import { resolveStepValue, type ReplayInputs } from "./parameter-resolution.js";
import type {
  ReplayErrorCode,
  ReplayOutputValue,
  ReplayResult,
} from "./result.js";

const ALL_ACTION_TYPES: CapabilityStep["type"][] = [
  "click",
  "fill",
  "select",
  "extract",
  "wait",
];

type ReplayEngineOptions = {
  policy?: PolicyEngine;
  evidenceLogger?: EvidenceLoggerLike;
};

type ReplayFailureSource = AutomationError | PolicyError;

export class ReplayEngine {
  private readonly policy: PolicyEngine;
  private readonly evidenceLogger: EvidenceLoggerLike;

  constructor(
    private readonly surface: ReplaySurface,
    options: ReplayEngineOptions = {},
  ) {
    this.policy =
      options.policy ??
      new PolicyEngine({
        allowedOrigins: [surface.targetUrl],
        allowedActionTypes: ALL_ACTION_TYPES,
      });
    this.evidenceLogger = options.evidenceLogger ?? new EvidenceLogger();
  }

  async replay(
    artifact: CapabilityArtifact,
    inputs: ReplayInputs,
  ): Promise<ReplayResult> {
    const evidence = await this.evidenceLogger.startRun(artifact, inputs);
    let surfaceOpened = false;

    try {
      try {
        this.policy.enforceOrigin(this.surface.targetUrl);
      } catch (error) {
        return await this.completeFailure(evidence, this.normalizeError(error));
      }

      await this.surface.open();
      surfaceOpened = true;

      const semanticResult = validateCapabilitySemantics(artifact);
      if (!semanticResult.success) {
        return await this.completeFailure(
          evidence,
          new AutomationError(
            AutomationErrorCode.INVALID_ARTIFACT,
            "Capability artifact failed semantic validation.",
            { observed: JSON.stringify(semanticResult.errors) },
          ),
          surfaceOpened,
        );
      }

      const inputError = this.validateInputs(artifact, inputs);
      if (inputError) {
        return await this.completeFailure(evidence, inputError, surfaceOpened);
      }

      const outputs: Record<string, ReplayOutputValue> = {};

      for (const step of artifact.steps) {
        const startedAt = performance.now();

        try {
          this.policy.enforceStep(step);
          await this.executeStep(step, artifact, inputs, outputs);
        } catch (error) {
          const normalized = this.normalizeStepError(error, step.id);
          const outcome =
            normalized instanceof PolicyError
              ? undefined
              : await this.detectBusinessOutcome(artifact);

          if (outcome) {
            await evidence.recordStep({
              stepId: step.id,
              actionType: step.type,
              status: "business_outcome",
              durationMs: elapsedMs(startedAt),
              result: outcome.code,
            });
            return await this.complete(evidence, outcome);
          }

          await evidence.recordStep({
            stepId: step.id,
            actionType: step.type,
            status: normalized instanceof PolicyError ? "blocked" : "failure",
            durationMs: elapsedMs(startedAt),
            errorCode: normalized.code,
          });
          return await this.completeFailure(evidence, normalized, surfaceOpened);
        }

        const outcome = await this.detectBusinessOutcome(artifact);
        if (outcome) {
          await evidence.recordStep({
            stepId: step.id,
            actionType: step.type,
            status: "business_outcome",
            durationMs: elapsedMs(startedAt),
            result: outcome.code,
          });
          return await this.complete(evidence, outcome);
        }

        for (const checkpoint of step.checkpoints ?? []) {
          if (!(await this.surface.evaluateCheckpoint(checkpoint))) {
            const checkpointOutcome = await this.detectBusinessOutcome(artifact);
            if (checkpointOutcome) {
              await evidence.recordStep({
                stepId: step.id,
                actionType: step.type,
                status: "business_outcome",
                durationMs: elapsedMs(startedAt),
                result: checkpointOutcome.code,
              });
              return await this.complete(evidence, checkpointOutcome);
            }

            const error = new AutomationError(
              AutomationErrorCode.CHECKPOINT_FAILED,
              `Checkpoint failed after step "${step.id}".`,
              {
                stepId: step.id,
                expected: JSON.stringify(checkpoint),
                observed: "Checkpoint evaluated to false",
              },
            );
            await evidence.recordStep({
              stepId: step.id,
              actionType: step.type,
              status: "failure",
              durationMs: elapsedMs(startedAt),
              errorCode: error.code,
            });
            return await this.completeFailure(evidence, error, surfaceOpened);
          }
        }

        await evidence.recordStep({
          stepId: step.id,
          actionType: step.type,
          status: "success",
          durationMs: elapsedMs(startedAt),
          result: step.type === "extract" ? `output:${step.output}` : "completed",
        });
      }

      if (!(await this.surface.evaluateCheckpoint(artifact.finalCheckpoint))) {
        const outcome = await this.detectBusinessOutcome(artifact);
        if (outcome) return await this.complete(evidence, outcome);

        return await this.completeFailure(
          evidence,
          new AutomationError(
            AutomationErrorCode.CHECKPOINT_FAILED,
            "The capability final checkpoint failed.",
            {
              expected: JSON.stringify(artifact.finalCheckpoint),
              observed: "Checkpoint evaluated to false",
            },
          ),
          surfaceOpened,
        );
      }

      return await this.complete(evidence, { status: "success", outputs });
    } catch (error) {
      return await this.completeFailure(
        evidence,
        this.normalizeError(error),
        surfaceOpened,
      );
    } finally {
      await this.surface.close().catch(() => undefined);
    }
  }

  private async complete(
    evidence: EvidenceRun,
    result: ReplayResult,
    screenshotPath?: string,
  ): Promise<ReplayResult> {
    await evidence.finish(result, screenshotPath);
    return result;
  }

  private async completeFailure(
    evidence: EvidenceRun,
    error: ReplayFailureSource,
    surfaceOpened = false,
  ): Promise<ReplayResult> {
    const result = this.failure(error);
    let screenshotPath: string | undefined;

    if (surfaceOpened) {
      try {
        await this.surface.captureScreenshot(evidence.screenshotPath);
        screenshotPath = evidence.screenshotPath;
      } catch {
        // Preserve the original failure if screenshot capture also fails.
      }
    }

    return this.complete(evidence, result, screenshotPath);
  }

  private async executeStep(
    step: CapabilityStep,
    artifact: CapabilityArtifact,
    inputs: ReplayInputs,
    outputs: Record<string, ReplayOutputValue>,
  ): Promise<void> {
    switch (step.type) {
      case "click":
        await this.surface.click(step.target);
        return;
      case "fill":
        await this.surface.fill(
          step.target,
          resolveStepValue(step.input, inputs, step.id),
        );
        return;
      case "select":
        await this.surface.select(
          step.target,
          resolveStepValue(step.option, inputs, step.id),
        );
        return;
      case "extract": {
        const text = await this.surface.extractText(step.target);
        outputs[step.output] = this.convertOutput(
          text,
          artifact.outputs[step.output],
          step.id,
        );
        return;
      }
      case "wait":
        if (
          !(await this.surface.evaluateCheckpoint(
            step.checkpoint,
            step.timeoutMs,
          ))
        ) {
          throw new AutomationError(
            AutomationErrorCode.CHECKPOINT_FAILED,
            `Wait condition failed for step "${step.id}".`,
            {
              stepId: step.id,
              expected: JSON.stringify(step.checkpoint),
              observed: "Checkpoint evaluated to false",
            },
          );
        }
    }
  }

  private async detectBusinessOutcome(
    artifact: CapabilityArtifact,
  ): Promise<Extract<ReplayResult, { status: "business_outcome" }> | undefined> {
    for (const outcome of artifact.expectedBusinessOutcomes ?? []) {
      if (await this.surface.evaluateCheckpoint(outcome.when, 0)) {
        return {
          status: "business_outcome",
          code: outcome.code,
          description: outcome.description,
        };
      }
    }
    return undefined;
  }

  private validateInputs(
    artifact: CapabilityArtifact,
    inputs: ReplayInputs,
  ): AutomationError | undefined {
    for (const [name, definition] of Object.entries(artifact.inputs)) {
      const value = inputs[name];
      if (value === undefined) {
        if (definition.required) {
          return new AutomationError(
            AutomationErrorCode.MISSING_INPUT,
            `Required replay input "${name}" was not provided.`,
            { expected: name, observed: "undefined" },
          );
        }
        continue;
      }

      if (!this.inputMatchesDefinition(value, definition)) {
        return new AutomationError(
          AutomationErrorCode.INVALID_INPUT,
          `Replay input "${name}" does not match its declared type.`,
          {
            expected:
              definition.type === "enum"
                ? `one of: ${definition.values.join(", ")}`
                : definition.type,
            observed: `${typeof value}: ${String(value)}`,
          },
        );
      }
    }
    return undefined;
  }

  private inputMatchesDefinition(
    value: string | number | boolean,
    definition: InputDefinition,
  ): boolean {
    switch (definition.type) {
      case "string":
      case "number":
      case "boolean":
        return typeof value === definition.type;
      case "enum":
        return typeof value === "string" && definition.values.includes(value);
    }
  }

  private convertOutput(
    text: string,
    definition: OutputDefinition,
    stepId: string,
  ): ReplayOutputValue {
    const trimmed = text.trim();
    switch (definition.type) {
      case "string":
        return trimmed;
      case "number": {
        const normalized = trimmed.replace(/[$,\s]/g, "");
        if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
          throw new AutomationError(
            AutomationErrorCode.STEP_ACTION_FAILED,
            "Extracted text for output cannot be converted to a number.",
            { stepId, expected: "number", observed: text },
          );
        }
        return Number(normalized);
      }
      case "boolean":
        if (/^true$/i.test(trimmed)) return true;
        if (/^false$/i.test(trimmed)) return false;
        throw new AutomationError(
          AutomationErrorCode.STEP_ACTION_FAILED,
          "Extracted text for output cannot be converted to a boolean.",
          { stepId, expected: "true or false", observed: text },
        );
    }
  }

  private normalizeStepError(
    error: unknown,
    stepId: string,
  ): ReplayFailureSource {
    if (error instanceof PolicyError) return error;
    if (error instanceof AutomationError) {
      if (error.stepId) return error;
      return new AutomationError(
        error.code,
        error.message,
        {
          stepId,
          expected: error.expected,
          observed: error.observed,
        },
        { cause: error },
      );
    }

    return new AutomationError(
      AutomationErrorCode.STEP_ACTION_FAILED,
      error instanceof Error ? error.message : `Step "${stepId}" failed.`,
      { stepId },
      { cause: error },
    );
  }

  private normalizeError(error: unknown): ReplayFailureSource {
    if (error instanceof PolicyError || error instanceof AutomationError) {
      return error;
    }
    return new AutomationError(
      AutomationErrorCode.UNEXPECTED_RUNTIME_ERROR,
      error instanceof Error ? error.message : "Unexpected runtime error",
      {},
      { cause: error },
    );
  }

  private failure(error: ReplayFailureSource): ReplayResult {
    const details = error instanceof PolicyError ? error.details : error;
    return {
      status: "failure",
      error: {
        code: error.code as ReplayErrorCode,
        message: error.message,
        ...(details.stepId ? { stepId: details.stepId } : {}),
        ...(details.expected ? { expected: details.expected } : {}),
        ...(details.observed ? { observed: details.observed } : {}),
      },
    };
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

import type {
  CapabilityArtifact,
  CapabilityStep,
  InputDefinition,
  OutputDefinition,
} from "../artifacts/schema.js";
import { validateCapabilitySemantics } from "../artifacts/schema.js";
import {
  AutomationError,
  AutomationErrorCode,
} from "../surface/automation-error.js";
import type { ReplaySurface } from "../surface/browser-surface.js";
import { resolveStepValue, type ReplayInputs } from "./parameter-resolution.js";
import type { ReplayOutputValue, ReplayResult } from "./result.js";

export class ReplayEngine {
  constructor(private readonly surface: ReplaySurface) {}

  async replay(
    artifact: CapabilityArtifact,
    inputs: ReplayInputs,
  ): Promise<ReplayResult> {
    const semanticResult = validateCapabilitySemantics(artifact);
    if (!semanticResult.success) {
      return this.failure(
        new AutomationError(
          AutomationErrorCode.INVALID_ARTIFACT,
          "Capability artifact failed semantic validation.",
          { observed: JSON.stringify(semanticResult.errors) },
        ),
      );
    }

    const inputError = this.validateInputs(artifact, inputs);
    if (inputError) {
      return this.failure(inputError);
    }

    const outputs: Record<string, ReplayOutputValue> = {};

    try {
      await this.surface.open();

      for (const step of artifact.steps) {
        try {
          await this.executeStep(step, artifact, inputs, outputs);
        } catch (error) {
          const outcome = await this.detectBusinessOutcome(artifact);
          if (outcome) return outcome;
          return this.failure(this.normalizeStepError(error, step.id));
        }

        const outcome = await this.detectBusinessOutcome(artifact);
        if (outcome) return outcome;

        for (const checkpoint of step.checkpoints ?? []) {
          if (!(await this.surface.evaluateCheckpoint(checkpoint))) {
            const checkpointOutcome = await this.detectBusinessOutcome(artifact);
            if (checkpointOutcome) return checkpointOutcome;
            return this.failure(
              new AutomationError(
                AutomationErrorCode.CHECKPOINT_FAILED,
                `Checkpoint failed after step "${step.id}".`,
                {
                  stepId: step.id,
                  expected: JSON.stringify(checkpoint),
                  observed: "Checkpoint evaluated to false",
                },
              ),
            );
          }
        }
      }

      if (!(await this.surface.evaluateCheckpoint(artifact.finalCheckpoint))) {
        const outcome = await this.detectBusinessOutcome(artifact);
        if (outcome) return outcome;
        return this.failure(
          new AutomationError(
            AutomationErrorCode.CHECKPOINT_FAILED,
            "The capability final checkpoint failed.",
            {
              expected: JSON.stringify(artifact.finalCheckpoint),
              observed: "Checkpoint evaluated to false",
            },
          ),
        );
      }

      return { status: "success", outputs };
    } catch (error) {
      return this.failure(
        error instanceof AutomationError
          ? error
          : new AutomationError(
              AutomationErrorCode.UNEXPECTED_RUNTIME_ERROR,
              error instanceof Error ? error.message : "Unexpected runtime error",
              {},
              { cause: error },
            ),
      );
    } finally {
      await this.surface.close().catch(() => undefined);
    }
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
  ): Promise<ReplayResult | undefined> {
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
            `Extracted text for output cannot be converted to a number.`,
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
          `Extracted text for output cannot be converted to a boolean.`,
          { stepId, expected: "true or false", observed: text },
        );
    }
  }

  private normalizeStepError(error: unknown, stepId: string): AutomationError {
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

  private failure(error: AutomationError): ReplayResult {
    return {
      status: "failure",
      error: {
        code: error.code,
        message: error.message,
        ...(error.stepId ? { stepId: error.stepId } : {}),
        ...(error.expected ? { expected: error.expected } : {}),
        ...(error.observed ? { observed: error.observed } : {}),
      },
    };
  }
}

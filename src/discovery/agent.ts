import type { CapabilityStep } from "../artifacts/schema.js";
import { PolicyEngine, PolicyError } from "../policy/policy-engine.js";
import { BrowserSurface } from "../surface/browser-surface.js";
import type { DiscoveryModel } from "./model.js";
import {
  DiscoveryFailureCode,
  type DiscoveryResult,
  type DiscoveryTraceEntry,
} from "./result.js";
import {
  DiscoveryActionSchema,
  type DiscoveryAction,
  type DiscoveryObservation,
} from "./schema.js";

export type DiscoveryAgentInput = {
  goal: string;
  targetUrl: string;
  maxSteps: number;
};

export interface DiscoverySurface {
  open(): Promise<void>;
  observe(): Promise<DiscoveryObservation>;
  click(target: Extract<DiscoveryAction, { type: "click" }>["target"]): Promise<void>;
  fill(
    target: Extract<DiscoveryAction, { type: "fill" }>["target"],
    value: string,
  ): Promise<void>;
  extractText(
    target: Extract<DiscoveryAction, { type: "extract" }>["target"],
  ): Promise<string>;
  close(): Promise<void>;
}

export type DiscoveryAgentOptions = {
  model: DiscoveryModel;
  policy: PolicyEngine;
  surfaceFactory?: (targetUrl: string) => DiscoverySurface;
  now?: () => Date;
};

export class DiscoveryAgent {
  private readonly surfaceFactory: (targetUrl: string) => DiscoverySurface;
  private readonly now: () => Date;

  constructor(private readonly options: DiscoveryAgentOptions) {
    this.surfaceFactory =
      options.surfaceFactory ??
      ((targetUrl) => new BrowserSurface({ appUrl: targetUrl }));
    this.now = options.now ?? (() => new Date());
  }

  async discover(input: DiscoveryAgentInput): Promise<DiscoveryResult> {
    const trace: DiscoveryTraceEntry[] = [];
    const extractedValues: Record<string, string> = {};
    const previousActions: string[] = [];

    try {
      this.options.policy.enforceOrigin(input.targetUrl);
    } catch (error) {
      return this.failure(
        DiscoveryFailureCode.POLICY_REJECTED,
        error,
        extractedValues,
        trace,
      );
    }

    const surface = this.surfaceFactory(input.targetUrl);
    try {
      try {
        await surface.open();
      } catch (error) {
        return this.failure(
          DiscoveryFailureCode.SURFACE_ERROR,
          error,
          extractedValues,
          trace,
        );
      }

      for (let stepNumber = 1; stepNumber <= input.maxSteps; stepNumber += 1) {
        let observation: DiscoveryObservation;
        try {
          observation = await surface.observe();
        } catch (error) {
          return this.failure(
            DiscoveryFailureCode.SURFACE_ERROR,
            error,
            extractedValues,
            trace,
          );
        }

        let action: DiscoveryAction;
        try {
          const decision = await this.options.model.decide({
            goal: input.goal,
            ...observation,
            previousActions: [...previousActions],
          });
          action = DiscoveryActionSchema.parse(decision);
        } catch (error) {
          return this.failure(
            DiscoveryFailureCode.MODEL_ERROR,
            error,
            extractedValues,
            trace,
          );
        }

        if (action.type === "finish") {
          trace.push({
            step: stepNumber,
            action,
            actionResult: action.summary,
            timestamp: this.now().toISOString(),
          });
          return {
            status: "success",
            summary: action.summary,
            extractedValues,
            trace,
          };
        }

        try {
          this.options.policy.enforceStep(toPolicyStep(action, stepNumber));
        } catch (error) {
          trace.push({
            step: stepNumber,
            action,
            actionResult: `Policy blocked action: ${errorMessage(error)}`,
            timestamp: this.now().toISOString(),
          });
          return this.failure(
            DiscoveryFailureCode.POLICY_REJECTED,
            error,
            extractedValues,
            trace,
          );
        }

        let actionResult: string;
        try {
          actionResult = await executeAction(surface, action, extractedValues);
        } catch (error) {
          trace.push({
            step: stepNumber,
            action,
            actionResult: `Action failed: ${errorMessage(error)}`,
            timestamp: this.now().toISOString(),
          });
          return this.failure(
            DiscoveryFailureCode.SURFACE_ERROR,
            error,
            extractedValues,
            trace,
          );
        }

        trace.push({
          step: stepNumber,
          action,
          actionResult,
          timestamp: this.now().toISOString(),
        });
        previousActions.push(actionResult);
      }

      return {
        status: "failure",
        error: {
          code: DiscoveryFailureCode.MAX_STEPS_REACHED,
          message: `Discovery reached the maximum of ${input.maxSteps} steps without finishing.`,
        },
        extractedValues,
        trace,
      };
    } finally {
      await surface.close().catch(() => undefined);
    }
  }

  private failure(
    code: DiscoveryFailureCode,
    error: unknown,
    extractedValues: Record<string, string>,
    trace: DiscoveryTraceEntry[],
  ): DiscoveryResult {
    return {
      status: "failure",
      error: {
        code,
        message: error instanceof Error ? error.message : "Discovery failed.",
        ...(error instanceof PolicyError ? { causeCode: error.code } : {}),
        ...(!(error instanceof PolicyError) &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? { causeCode: error.code }
          : {}),
      },
      extractedValues,
      trace,
    };
  }
}

async function executeAction(
  surface: DiscoverySurface,
  action: Exclude<DiscoveryAction, { type: "finish" }>,
  extractedValues: Record<string, string>,
): Promise<string> {
  switch (action.type) {
    case "click":
      await surface.click(action.target);
      return `Clicked ${describeTarget(action.target)}.`;
    case "fill":
      await surface.fill(action.target, action.value);
      return `Filled ${describeTarget(action.target)}.`;
    case "extract": {
      const value = await surface.extractText(action.target);
      extractedValues[action.name] = value;
      return `Extracted ${action.name}: ${value}`;
    }
  }
}

function toPolicyStep(
  action: Exclude<DiscoveryAction, { type: "finish" }>,
  stepNumber: number,
): CapabilityStep {
  const base = {
    id: `discovery-step-${stepNumber}`,
    risk: action.type === "extract" ? ("safe" as const) : ("reversible" as const),
  };

  switch (action.type) {
    case "click":
      return { ...base, type: "click", target: action.target };
    case "fill":
      return {
        ...base,
        type: "fill",
        target: action.target,
        input: { value: action.value },
      };
    case "extract":
      return {
        ...base,
        type: "extract",
        target: action.target,
        output: action.name,
      };
  }
}

function describeTarget(
  target: Exclude<DiscoveryAction, { type: "finish" }>["target"],
): string {
  if (target.description) return target.description;
  const locator = target.locators[0];
  switch (locator.type) {
    case "role":
      return `${locator.role} "${locator.name}"`;
    case "label":
    case "text":
      return `"${locator.text}"`;
    case "css":
      return `declared CSS target`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

import type { AutomationErrorCode } from "../surface/automation-error.js";
import type { PolicyErrorCode } from "../policy/policy-engine.js";

export type ReplayOutputValue = string | number | boolean;
export type ReplayErrorCode = AutomationErrorCode | PolicyErrorCode;

export type ReplayResult =
  | {
      status: "success";
      outputs: Record<string, ReplayOutputValue>;
    }
  | {
      status: "business_outcome";
      code: string;
      description: string;
    }
  | {
      status: "failure";
      error: {
        code: ReplayErrorCode;
        message: string;
        stepId?: string;
        expected?: string;
        observed?: string;
      };
    };

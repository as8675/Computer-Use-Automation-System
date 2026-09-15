import type { AutomationErrorCode } from "../surface/automation-error.js";

export type ReplayOutputValue = string | number | boolean;

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
        code: AutomationErrorCode;
        message: string;
        stepId?: string;
        expected?: string;
        observed?: string;
      };
    };

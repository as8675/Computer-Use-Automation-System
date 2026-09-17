import type { DiscoveryAction } from "./schema.js";

export type DiscoveryTraceEntry = {
  step: number;
  action: DiscoveryAction;
  actionResult: string;
  timestamp: string;
};

export const DiscoveryFailureCode = {
  MAX_STEPS_REACHED: "MAX_STEPS_REACHED",
  POLICY_REJECTED: "POLICY_REJECTED",
  MODEL_ERROR: "MODEL_ERROR",
  SURFACE_ERROR: "SURFACE_ERROR",
} as const;

export type DiscoveryFailureCode =
  (typeof DiscoveryFailureCode)[keyof typeof DiscoveryFailureCode];

export type DiscoveryResult =
  | {
      status: "success";
      summary: string;
      extractedValues: Record<string, string>;
      trace: DiscoveryTraceEntry[];
    }
  | {
      status: "failure";
      error: {
        code: DiscoveryFailureCode;
        message: string;
        causeCode?: string;
      };
      extractedValues: Record<string, string>;
      trace: DiscoveryTraceEntry[];
    };

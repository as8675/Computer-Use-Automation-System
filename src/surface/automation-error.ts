export const AutomationErrorCode = {
  LOCATOR_NOT_FOUND: "LOCATOR_NOT_FOUND",
  MISSING_INPUT: "MISSING_INPUT",
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_ARTIFACT: "INVALID_ARTIFACT",
  STEP_ACTION_FAILED: "STEP_ACTION_FAILED",
  CHECKPOINT_FAILED: "CHECKPOINT_FAILED",
  UNEXPECTED_RUNTIME_ERROR: "UNEXPECTED_RUNTIME_ERROR",
} as const;

export type AutomationErrorCode =
  (typeof AutomationErrorCode)[keyof typeof AutomationErrorCode];

export type AutomationErrorDetails = {
  stepId?: string;
  expected?: string;
  observed?: string;
};

export class AutomationError extends Error {
  readonly code: AutomationErrorCode;
  readonly stepId?: string;
  readonly expected?: string;
  readonly observed?: string;

  constructor(
    code: AutomationErrorCode,
    message: string,
    details: AutomationErrorDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutomationError";
    this.code = code;
    this.stepId = details.stepId;
    this.expected = details.expected;
    this.observed = details.observed;
  }
}

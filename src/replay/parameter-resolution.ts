import type { StringStepValue } from "../artifacts/schema.js";
import {
  AutomationError,
  AutomationErrorCode,
} from "../surface/automation-error.js";

export type ReplayInputValue = string | number | boolean;
export type ReplayInputs = Record<string, ReplayInputValue | undefined>;

export function resolveStepValue(
  value: StringStepValue,
  inputs: ReplayInputs,
  stepId?: string,
): string {
  if ("value" in value) {
    return value.value;
  }

  const inputName = value.parameter.slice(2, -2);
  const resolved = inputs[inputName];
  if (resolved === undefined) {
    throw new AutomationError(
      AutomationErrorCode.MISSING_INPUT,
      `Required replay input "${inputName}" was not provided.`,
      { stepId, expected: inputName, observed: "undefined" },
    );
  }

  return String(resolved);
}

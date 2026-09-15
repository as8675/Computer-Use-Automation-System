import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);
const IdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

export const RiskClassificationSchema = z.enum([
  "safe",
  "reversible",
  "irreversible",
]);

const InputDefinitionBaseSchema = z.object({
  required: z.boolean(),
  description: NonEmptyStringSchema,
  sensitive: z.boolean(),
});

export const InputDefinitionSchema = z.discriminatedUnion("type", [
  InputDefinitionBaseSchema.extend({ type: z.literal("string") }).strict(),
  InputDefinitionBaseSchema.extend({ type: z.literal("number") }).strict(),
  InputDefinitionBaseSchema.extend({ type: z.literal("boolean") }).strict(),
  InputDefinitionBaseSchema.extend({
    type: z.literal("enum"),
    values: z
      .array(NonEmptyStringSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, {
        message: "Enum values must be unique",
      }),
  }).strict(),
]);

export const OutputDefinitionSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    description: NonEmptyStringSchema,
  })
  .strict();

export const ParameterReferenceSchema = z
  .string()
  .regex(/^\{\{[A-Za-z][A-Za-z0-9_-]*\}\}$/, {
    message: "Parameter references must use the form {{inputName}}",
  });

export const LocatorStrategySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("role"),
      role: NonEmptyStringSchema,
      name: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("label"),
      text: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      text: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("css"),
      selector: NonEmptyStringSchema,
    })
    .strict(),
]);

export const ControlTargetSchema = z
  .object({
    description: NonEmptyStringSchema.optional(),
    locators: z.array(LocatorStrategySchema).min(1),
  })
  .strict();

export const CheckpointSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("textVisible"),
      text: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("urlMatches"),
      pattern: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("elementVisible"),
      target: ControlTargetSchema,
    })
    .strict(),
]);

const StepBaseSchema = z.object({
  id: IdentifierSchema,
  description: NonEmptyStringSchema.optional(),
  risk: RiskClassificationSchema,
  checkpoints: z.array(CheckpointSchema).optional(),
});

export const StringStepValueSchema = z.union([
  z.object({ value: z.string() }).strict(),
  z.object({ parameter: ParameterReferenceSchema }).strict(),
]);

export const CapabilityStepSchema = z.discriminatedUnion("type", [
  StepBaseSchema.extend({
    type: z.literal("click"),
    target: ControlTargetSchema,
  }).strict(),
  StepBaseSchema.extend({
    type: z.literal("fill"),
    target: ControlTargetSchema,
    input: StringStepValueSchema,
  }).strict(),
  StepBaseSchema.extend({
    type: z.literal("select"),
    target: ControlTargetSchema,
    option: StringStepValueSchema,
  }).strict(),
  StepBaseSchema.extend({
    type: z.literal("extract"),
    target: ControlTargetSchema,
    output: IdentifierSchema,
  }).strict(),
  StepBaseSchema.extend({
    type: z.literal("wait"),
    checkpoint: CheckpointSchema,
    timeoutMs: z.number().int().positive().optional(),
  }).strict(),
]);

export const ExpectedBusinessOutcomeSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    description: NonEmptyStringSchema,
    when: CheckpointSchema,
  })
  .strict();

export const CapabilityArtifactSchema = z
  .object({
    metadata: z
      .object({
        schemaVersion: NonEmptyStringSchema,
        capabilityVersion: NonEmptyStringSchema,
        name: NonEmptyStringSchema,
        description: NonEmptyStringSchema,
      })
      .strict(),
    inputs: z.record(IdentifierSchema, InputDefinitionSchema),
    outputs: z.record(IdentifierSchema, OutputDefinitionSchema),
    steps: z.array(CapabilityStepSchema).min(1),
    finalCheckpoint: CheckpointSchema,
    expectedBusinessOutcomes: z.array(ExpectedBusinessOutcomeSchema).optional(),
  })
  .strict();

export type RiskClassification = z.infer<typeof RiskClassificationSchema>;
export type InputDefinition = z.infer<typeof InputDefinitionSchema>;
export type OutputDefinition = z.infer<typeof OutputDefinitionSchema>;
export type ParameterReference = z.infer<typeof ParameterReferenceSchema>;
export type StringStepValue = z.infer<typeof StringStepValueSchema>;
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;
export type ControlTarget = z.infer<typeof ControlTargetSchema>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type CapabilityStep = z.infer<typeof CapabilityStepSchema>;
export type ExpectedBusinessOutcome = z.infer<
  typeof ExpectedBusinessOutcomeSchema
>;
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;

type SemanticErrorBase = {
  message: string;
  path: Array<string | number>;
  stepId: string;
};

export type CapabilitySemanticError =
  | (SemanticErrorBase & {
      code: "UNDECLARED_INPUT_REFERENCE";
      inputName: string;
    })
  | (SemanticErrorBase & {
      code: "UNDECLARED_OUTPUT_REFERENCE";
      outputName: string;
    })
  | (SemanticErrorBase & {
      code: "DUPLICATE_STEP_ID";
      firstStepIndex: number;
      duplicateStepIndex: number;
    });

export type CapabilitySemanticValidationResult =
  | { success: true; errors: [] }
  | { success: false; errors: CapabilitySemanticError[] };

function parameterName(reference: ParameterReference): string {
  return reference.slice(2, -2);
}

export function validateCapabilitySemantics(
  artifact: CapabilityArtifact,
): CapabilitySemanticValidationResult {
  const errors: CapabilitySemanticError[] = [];
  const stepIndexes = new Map<string, number>();

  artifact.steps.forEach((step, stepIndex) => {
    const firstStepIndex = stepIndexes.get(step.id);
    if (firstStepIndex !== undefined) {
      errors.push({
        code: "DUPLICATE_STEP_ID",
        message: `Step ID "${step.id}" is already used by step ${firstStepIndex}.`,
        path: ["steps", stepIndex, "id"],
        stepId: step.id,
        firstStepIndex,
        duplicateStepIndex: stepIndex,
      });
    } else {
      stepIndexes.set(step.id, stepIndex);
    }

    if (step.type === "fill" && "parameter" in step.input) {
      const inputName = parameterName(step.input.parameter);
      if (!(inputName in artifact.inputs)) {
        errors.push({
          code: "UNDECLARED_INPUT_REFERENCE",
          message: `Input "${inputName}" is not declared by this capability.`,
          path: ["steps", stepIndex, "input", "parameter"],
          stepId: step.id,
          inputName,
        });
      }
    }

    if (step.type === "select" && "parameter" in step.option) {
      const inputName = parameterName(step.option.parameter);
      if (!(inputName in artifact.inputs)) {
        errors.push({
          code: "UNDECLARED_INPUT_REFERENCE",
          message: `Input "${inputName}" is not declared by this capability.`,
          path: ["steps", stepIndex, "option", "parameter"],
          stepId: step.id,
          inputName,
        });
      }
    }

    if (step.type === "extract" && !(step.output in artifact.outputs)) {
      errors.push({
        code: "UNDECLARED_OUTPUT_REFERENCE",
        message: `Output "${step.output}" is not declared by this capability.`,
        path: ["steps", stepIndex, "output"],
        stepId: step.id,
        outputName: step.output,
      });
    }
  });

  return errors.length === 0
    ? { success: true, errors: [] }
    : { success: false, errors };
}

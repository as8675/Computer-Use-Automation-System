import { z } from "zod";

import { ControlTargetSchema } from "../artifacts/schema.js";

const NonEmptyStringSchema = z.string().trim().min(1);

export const DiscoveryActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("click"),
      target: ControlTargetSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("fill"),
      target: ControlTargetSchema,
      value: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("extract"),
      target: ControlTargetSchema,
      name: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("finish"),
      summary: NonEmptyStringSchema,
    })
    .strict(),
]);

export const InteractiveControlDescriptionSchema = z
  .object({
    role: NonEmptyStringSchema,
    accessibleName: NonEmptyStringSchema.optional(),
    label: NonEmptyStringSchema.optional(),
    visibleText: NonEmptyStringSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

export const DiscoveryDecisionInputSchema = z
  .object({
    goal: NonEmptyStringSchema,
    currentUrl: NonEmptyStringSchema,
    visibleText: z.string(),
    interactiveControls: z.array(InteractiveControlDescriptionSchema),
    previousActions: z.array(z.string()),
  })
  .strict();

export const DiscoveryObservationSchema = DiscoveryDecisionInputSchema.pick({
  currentUrl: true,
  visibleText: true,
  interactiveControls: true,
});

export type DiscoveryAction = z.infer<typeof DiscoveryActionSchema>;
export type InteractiveControlDescription = z.infer<
  typeof InteractiveControlDescriptionSchema
>;
export type DiscoveryDecisionInput = z.infer<
  typeof DiscoveryDecisionInputSchema
>;
export type DiscoveryObservation = z.infer<typeof DiscoveryObservationSchema>;

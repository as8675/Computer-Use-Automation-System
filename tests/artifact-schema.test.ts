import { describe, expect, it } from "vitest";

import {
  CapabilityArtifactSchema,
  CapabilityStepSchema,
  CheckpointSchema,
  InputDefinitionSchema,
  validateCapabilitySemantics,
  type CapabilityArtifact,
  type ControlTarget,
} from "../src/artifacts/schema.js";

const memberIdTarget: ControlTarget = {
  description: "Member ID field",
  locators: [
    { type: "role", role: "textbox", name: "Member ID" },
    { type: "label", text: "Member ID" },
    { type: "css", selector: "#member-id" },
  ],
};

const validCapability: CapabilityArtifact = {
  metadata: {
    schemaVersion: "1.0.0",
    capabilityVersion: "1.0.0",
    name: "look-up-member",
    description: "Looks up a banking member by ID.",
  },
  inputs: {
    memberId: {
      type: "string",
      required: true,
      description: "Member identifier",
      sensitive: true,
    },
    includeClosedAccounts: {
      type: "boolean",
      required: false,
      description: "Whether closed accounts should be included",
      sensitive: false,
    },
    resultLimit: {
      type: "number",
      required: false,
      description: "Maximum number of results",
      sensitive: false,
    },
    accountKind: {
      type: "enum",
      values: ["checking", "savings"],
      required: false,
      description: "Optional account type filter",
      sensitive: false,
    },
  },
  outputs: {
    memberName: {
      type: "string",
      description: "Name displayed for the member",
    },
  },
  steps: [
    {
      id: "fill-member-id",
      type: "fill",
      risk: "safe",
      target: memberIdTarget,
      input: { parameter: "{{memberId}}" },
    },
    {
      id: "submit-search",
      type: "click",
      risk: "reversible",
      target: {
        locators: [{ type: "role", role: "button", name: "Search" }],
      },
      checkpoints: [{ type: "urlMatches", pattern: "/members/search" }],
    },
    {
      id: "wait-for-result",
      type: "wait",
      risk: "safe",
      checkpoint: {
        type: "elementVisible",
        target: {
          locators: [{ type: "text", text: "Member details" }],
        },
      },
      timeoutMs: 5_000,
    },
    {
      id: "extract-member-name",
      type: "extract",
      risk: "safe",
      target: {
        locators: [{ type: "css", selector: "[data-member-name]" }],
      },
      output: "memberName",
    },
  ],
  finalCheckpoint: {
    type: "elementVisible",
    target: {
      locators: [{ type: "text", text: "Member Details" }],
    },
  },
  expectedBusinessOutcomes: [
    {
      code: "MEMBER_NOT_FOUND",
      description: "No member exists for the supplied identifier.",
      when: { type: "textVisible", text: "Member not found" },
    },
  ],
};

describe("CapabilityArtifactSchema", () => {
  it("accepts a valid capability", () => {
    expect(CapabilityArtifactSchema.parse(validCapability)).toEqual(
      validCapability,
    );
  });

  it("rejects an invalid capability", () => {
    const invalid = {
      ...validCapability,
      metadata: { ...validCapability.metadata, name: "" },
      steps: [],
    };

    expect(CapabilityArtifactSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    {
      id: "click",
      type: "click",
      risk: "safe",
      target: memberIdTarget,
    },
    {
      id: "fill",
      type: "fill",
      risk: "safe",
      target: memberIdTarget,
      input: { parameter: "{{memberId}}" },
    },
    {
      id: "select",
      type: "select",
      risk: "reversible",
      target: memberIdTarget,
      option: { value: "checking" },
    },
    {
      id: "extract",
      type: "extract",
      risk: "safe",
      target: memberIdTarget,
      output: "memberName",
    },
    {
      id: "wait",
      type: "wait",
      risk: "safe",
      checkpoint: { type: "textVisible", text: "Ready" },
    },
  ])("accepts the $type step variant", (step) => {
    expect(CapabilityStepSchema.safeParse(step).success).toBe(true);
  });

  it("rejects a step whose fields do not match its discriminator", () => {
    expect(
      CapabilityStepSchema.safeParse({
        id: "bad-click",
        type: "click",
        risk: "safe",
        target: memberIdTarget,
        input: { value: "unexpected" },
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      type: "enum",
      values: [],
      required: true,
      description: "Empty enum",
      sensitive: false,
    },
    {
      type: "enum",
      values: ["same", "same"],
      required: true,
      description: "Duplicate enum",
      sensitive: false,
    },
    {
      type: "date",
      required: true,
      description: "Unsupported input type",
      sensitive: false,
    },
  ])("rejects invalid input definition %#", (input) => {
    expect(InputDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an invalid checkpoint", () => {
    expect(
      CheckpointSchema.safeParse({
        type: "elementVisible",
        target: { locators: [] },
      }).success,
    ).toBe(false);
  });

  it("survives JSON serialization and validated deserialization", () => {
    const serialized = JSON.stringify(validCapability);
    const deserialized = CapabilityArtifactSchema.parse(JSON.parse(serialized));

    expect(deserialized).toEqual(validCapability);
  });

  it("passes semantic validation when all references are declared", () => {
    expect(validateCapabilitySemantics(validCapability)).toEqual({
      success: true,
      errors: [],
    });
  });

  it("returns structured errors for undeclared input and output references", () => {
    const artifact = CapabilityArtifactSchema.parse({
      ...validCapability,
      steps: [
        {
          id: "fill-unknown-input",
          type: "fill",
          risk: "safe",
          target: memberIdTarget,
          input: { parameter: "{{missingInput}}" },
        },
        {
          id: "select-unknown-input",
          type: "select",
          risk: "safe",
          target: memberIdTarget,
          option: { parameter: "{{missingChoice}}" },
        },
        {
          id: "extract-unknown-output",
          type: "extract",
          risk: "safe",
          target: memberIdTarget,
          output: "missingOutput",
        },
      ],
    });

    expect(validateCapabilitySemantics(artifact)).toMatchObject({
      success: false,
      errors: [
        {
          code: "UNDECLARED_INPUT_REFERENCE",
          inputName: "missingInput",
          path: ["steps", 0, "input", "parameter"],
        },
        {
          code: "UNDECLARED_INPUT_REFERENCE",
          inputName: "missingChoice",
          path: ["steps", 1, "option", "parameter"],
        },
        {
          code: "UNDECLARED_OUTPUT_REFERENCE",
          outputName: "missingOutput",
          path: ["steps", 2, "output"],
        },
      ],
    });
  });

  it("returns a structured error for duplicate step IDs", () => {
    const artifact = CapabilityArtifactSchema.parse({
      ...validCapability,
      steps: [validCapability.steps[0], validCapability.steps[0]],
    });

    expect(validateCapabilitySemantics(artifact)).toMatchObject({
      success: false,
      errors: [
        {
          code: "DUPLICATE_STEP_ID",
          stepId: "fill-member-id",
          firstStepIndex: 0,
          duplicateStepIndex: 1,
          path: ["steps", 1, "id"],
        },
      ],
    });
  });
});

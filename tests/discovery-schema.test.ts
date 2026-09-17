import { describe, expect, it } from "vitest";

import { DiscoveryActionSchema } from "../src/discovery/schema.js";

const target = {
  description: "Member ID field",
  locators: [
    { type: "role", role: "textbox", name: "Member ID" },
    { type: "label", text: "Member ID" },
  ],
} as const;

describe("DiscoveryActionSchema", () => {
  it("accepts a valid click action", () => {
    expect(
      DiscoveryActionSchema.parse({ type: "click", target }),
    ).toEqual({ type: "click", target });
  });

  it("accepts a valid fill action", () => {
    expect(
      DiscoveryActionSchema.parse({
        type: "fill",
        target,
        value: "12345",
      }),
    ).toEqual({ type: "fill", target, value: "12345" });
  });

  it("accepts a valid extract action", () => {
    expect(
      DiscoveryActionSchema.parse({
        type: "extract",
        target,
        name: "savingsBalance",
      }),
    ).toEqual({ type: "extract", target, name: "savingsBalance" });
  });

  it("accepts a valid finish action", () => {
    expect(
      DiscoveryActionSchema.parse({
        type: "finish",
        summary: "The savings balance was extracted.",
      }),
    ).toEqual({
      type: "finish",
      summary: "The savings balance was extracted.",
    });
  });

  it("rejects a malformed action", () => {
    expect(
      DiscoveryActionSchema.safeParse({
        type: "fill",
        target: { locators: [] },
        value: 12345,
      }).success,
    ).toBe(false);
  });
});

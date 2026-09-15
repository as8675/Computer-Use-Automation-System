import { describe, expect, it } from "vitest";

import type { CapabilityStep } from "../src/artifacts/schema.js";
import {
  PolicyEngine,
  PolicyError,
} from "../src/policy/policy-engine.js";

const safeClick: CapabilityStep = {
  id: "search",
  type: "click",
  risk: "safe",
  target: {
    locators: [{ type: "role", role: "button", name: "Search" }],
  },
};

function policy(allowedActionTypes: CapabilityStep["type"][] = ["click"]) {
  return new PolicyEngine({
    allowedOrigins: ["http://127.0.0.1:8080"],
    allowedDomains: ["example.test"],
    allowedActionTypes,
  });
}

describe("PolicyEngine", () => {
  it("allows a safe action", () => {
    expect(() => policy().enforceStep(safeClick)).not.toThrow();
  });

  it("blocks an irreversible action", () => {
    expect(() =>
      policy().enforceStep({ ...safeClick, risk: "irreversible" }),
    ).toThrow(
      expect.objectContaining<Partial<PolicyError>>({
        code: "RISK_NOT_ALLOWED",
      }),
    );
  });

  it("blocks a disallowed origin", () => {
    expect(() => policy().enforceOrigin("https://untrusted.example" )).toThrow(
      expect.objectContaining<Partial<PolicyError>>({
        code: "ORIGIN_NOT_ALLOWED",
      }),
    );
  });

  it("blocks a disallowed action type", () => {
    expect(() => policy(["fill"]).enforceStep(safeClick)).toThrow(
      expect.objectContaining<Partial<PolicyError>>({
        code: "ACTION_NOT_ALLOWED",
      }),
    );
  });
});

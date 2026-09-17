import { describe, expect, it } from "vitest";

import type {
  CapabilityStep,
  ControlTarget,
} from "../src/artifacts/schema.js";
import type { DiscoverySurface } from "../src/discovery/agent.js";
import { DiscoveryAgent } from "../src/discovery/agent.js";
import type { DiscoveryModel } from "../src/discovery/model.js";
import type {
  DiscoveryAction,
  DiscoveryObservation,
} from "../src/discovery/schema.js";
import { PolicyEngine } from "../src/policy/policy-engine.js";

const fieldTarget: ControlTarget = {
  description: "Member ID field",
  locators: [{ type: "label", text: "Member ID" }],
};

const searchTarget: ControlTarget = {
  description: "Search button",
  locators: [{ type: "role", role: "button", name: "Search" }],
};

const balanceTarget: ControlTarget = {
  description: "Savings balance",
  locators: [{ type: "css", selector: ".savings-balance" }],
};

class SequenceModel implements DiscoveryModel {
  private index = 0;
  readonly inputs: string[][] = [];

  constructor(private readonly actions: DiscoveryAction[]) {}

  async decide(input: Parameters<DiscoveryModel["decide"]>[0]) {
    this.inputs.push(input.previousActions);
    const action = this.actions[this.index];
    this.index += 1;
    if (!action) throw new Error("No mocked action remains");
    return action;
  }
}

class FakeSurface implements DiscoverySurface {
  opened = false;
  closed = false;
  calls: string[] = [];

  async open() {
    this.opened = true;
  }

  async observe(): Promise<DiscoveryObservation> {
    return {
      currentUrl: "http://example.test/members",
      visibleText: "Member Search",
      interactiveControls: [],
    };
  }

  async fill(_target: ControlTarget, value: string) {
    this.calls.push(`fill:${value}`);
  }

  async click() {
    this.calls.push("click");
  }

  async extractText() {
    this.calls.push("extract");
    return "$7,845.44";
  }

  async close() {
    this.closed = true;
  }
}

function policy(
  allowedActionTypes: CapabilityStep["type"][] = [
    "click",
    "fill",
    "extract",
  ],
) {
  return new PolicyEngine({
    allowedOrigins: ["http://example.test"],
    allowedActionTypes,
  });
}

function agent(
  model: DiscoveryModel,
  surface: FakeSurface,
  selectedPolicy = policy(),
) {
  return new DiscoveryAgent({
    model,
    policy: selectedPolicy,
    surfaceFactory: () => surface,
    now: () => new Date("2026-09-17T12:00:00.000Z"),
  });
}

const input = {
  goal: "Return the member's savings balance",
  targetUrl: "http://example.test/members",
  maxSteps: 4,
};

describe("DiscoveryAgent", () => {
  it("runs fill, click, extract, and finish one action at a time", async () => {
    const model = new SequenceModel([
      { type: "fill", target: fieldTarget, value: "12345" },
      { type: "click", target: searchTarget },
      { type: "extract", target: balanceTarget, name: "savingsBalance" },
      { type: "finish", summary: "Savings balance found." },
    ]);
    const surface = new FakeSurface();

    const result = await agent(model, surface).discover(input);

    expect(result).toMatchObject({
      status: "success",
      summary: "Savings balance found.",
      extractedValues: { savingsBalance: "$7,845.44" },
    });
    expect(result.trace).toHaveLength(4);
    expect(surface.calls).toEqual(["fill:12345", "click", "extract"]);
    expect(model.inputs[3]).toContain("Extracted savingsBalance: $7,845.44");
    expect(surface.closed).toBe(true);
  });

  it("stops when the maximum step count is reached", async () => {
    const model = new SequenceModel([
      { type: "click", target: searchTarget },
      { type: "click", target: searchTarget },
    ]);
    const surface = new FakeSurface();

    const result = await agent(model, surface).discover({
      ...input,
      maxSteps: 2,
    });

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "MAX_STEPS_REACHED" },
    });
    expect(result.trace).toHaveLength(2);
  });

  it("stops before executing a policy-blocked action", async () => {
    const surface = new FakeSurface();
    const model = new SequenceModel([{ type: "click", target: searchTarget }]);

    const result = await agent(model, surface, policy(["fill"])).discover(input);

    expect(result).toMatchObject({
      status: "failure",
      error: {
        code: "POLICY_REJECTED",
        causeCode: "ACTION_NOT_ALLOWED",
      },
    });
    expect(surface.calls).toEqual([]);
  });

  it("stops cleanly when the model fails", async () => {
    const surface = new FakeSurface();
    const model: DiscoveryModel = {
      decide: async () => {
        throw new Error("model unavailable");
      },
    };

    const result = await agent(model, surface).discover(input);

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "MODEL_ERROR", message: "model unavailable" },
    });
    expect(surface.calls).toEqual([]);
    expect(surface.closed).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { BrowserType, Locator } from "playwright";

import {
  CapabilityArtifactSchema,
  type CapabilityArtifact,
  type Checkpoint,
  type ControlTarget,
} from "../src/artifacts/schema.js";
import type {
  EvidenceLoggerLike,
  EvidenceRun,
} from "../src/evidence/evidence-logger.js";
import { ReplayEngine } from "../src/replay/engine.js";
import { resolveStepValue } from "../src/replay/parameter-resolution.js";
import {
  BrowserSurface,
  type ReplaySurface,
} from "../src/surface/browser-surface.js";

const testEvidenceLogger: EvidenceLoggerLike = {
  async startRun(): Promise<EvidenceRun> {
    return {
      runId: "test-run",
      runDirectory: "test-evidence/test-run",
      screenshotPath: "test-evidence/test-run/failure.png",
      async recordStep() {},
      async finish() {},
    };
  },
};

function createReplayEngine(surface: ReplaySurface): ReplayEngine {
  return new ReplayEngine(surface, { evidenceLogger: testEvidenceLogger });
}

const fieldTarget: ControlTarget = {
  locators: [{ type: "label", text: "Member ID" }],
};

function createArtifact(): CapabilityArtifact {
  return CapabilityArtifactSchema.parse({
    metadata: {
      schemaVersion: "1.0.0",
      capabilityVersion: "1.0.0",
      name: "test-replay",
      description: "Replay test artifact",
    },
    inputs: {
      memberId: {
        type: "string",
        required: true,
        description: "Member ID",
        sensitive: true,
      },
    },
    outputs: {
      savingsBalance: {
        type: "number",
        description: "Savings balance",
      },
    },
    steps: [
      {
        id: "fill-member-id",
        type: "fill",
        risk: "safe",
        target: fieldTarget,
        input: { parameter: "{{memberId}}" },
      },
      {
        id: "search",
        type: "click",
        risk: "safe",
        target: {
          locators: [{ type: "role", role: "button", name: "Search" }],
        },
      },
      {
        id: "extract-balance",
        type: "extract",
        risk: "safe",
        target: { locators: [{ type: "css", selector: ".balance" }] },
        output: "savingsBalance",
      },
    ],
    finalCheckpoint: { type: "textVisible", text: "Savings" },
    expectedBusinessOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        description: "No matching member exists.",
        when: { type: "textVisible", text: "Member not found" },
      },
    ],
  });
}

class FakeSurface implements ReplaySurface {
  readonly targetUrl = "http://example.test";
  searched = false;
  closed = false;
  screenshotCaptured = false;

  constructor(
    private readonly options: {
      businessOutcome?: boolean;
      clickError?: Error;
    } = {},
  ) {}

  async open(): Promise<void> {}
  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async captureScreenshot(): Promise<void> {
    this.screenshotCaptured = true;
  }

  async click(): Promise<void> {
    if (this.options.clickError) throw this.options.clickError;
    this.searched = true;
  }

  async extractText(): Promise<string> {
    return "$7,845.44";
  }

  async evaluateCheckpoint(checkpoint: Checkpoint): Promise<boolean> {
    if (checkpoint.type === "textVisible" && checkpoint.text === "Member not found") {
      return Boolean(this.options.businessOutcome && this.searched);
    }
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("parameter resolution", () => {
  it("resolves literal and parameter wrappers", () => {
    expect(resolveStepValue({ value: "12345" }, {})).toBe("12345");
    expect(
      resolveStepValue({ parameter: "{{memberId}}" }, { memberId: "67890" }),
    ).toBe("67890");
  });

  it("throws a structured error for a missing parameter", () => {
    expect(() =>
      resolveStepValue({ parameter: "{{memberId}}" }, {}, "fill-member-id"),
    ).toThrow(
      expect.objectContaining({
        code: "MISSING_INPUT",
        stepId: "fill-member-id",
      }),
    );
  });
});

describe("ReplayEngine", () => {
  it("returns typed extracted outputs on success", async () => {
    const surface = new FakeSurface();
    const result = await createReplayEngine(surface).replay(createArtifact(), {
      memberId: "12345",
    });

    expect(result).toEqual({
      status: "success",
      outputs: { savingsBalance: 7845.44 },
    });
    expect(surface.closed).toBe(true);
  });

  it("returns a declared business outcome independently of failures", async () => {
    const result = await createReplayEngine(
      new FakeSurface({ businessOutcome: true }),
    ).replay(createArtifact(), { memberId: "00000" });

    expect(result).toEqual({
      status: "business_outcome",
      code: "MEMBER_NOT_FOUND",
      description: "No matching member exists.",
    });
  });

  it("returns a structured step failure", async () => {
    const surface = new FakeSurface({
      clickError: new Error("button became detached"),
    });
    const result = await createReplayEngine(surface).replay(createArtifact(), {
      memberId: "12345",
    });

    expect(result).toEqual({
      status: "failure",
      error: {
        code: "STEP_ACTION_FAILED",
        message: "button became detached",
        stepId: "search",
      },
    });
    expect(surface.screenshotCaptured).toBe(true);
  });
});

describe("BrowserSurface locator fallback", () => {
  it("tries declared strategies in order", async () => {
    const attempts: string[] = [];
    const locator = (name: string, resolves: boolean) => ({
      first: () => locator(name, resolves),
      waitFor: async () => {
        attempts.push(name);
        if (!resolves) throw new Error("not visible");
      },
    });
    const page = {
      goto: async () => undefined,
      getByRole: () => locator("role", false),
      getByLabel: () => locator("label", true),
    };
    const browser = {
      newPage: async () => page,
      close: async () => undefined,
    };
    const browserType = {
      launch: async () => browser,
    } as unknown as BrowserType;
    const surface = new BrowserSurface(
      { appUrl: "http://example.test", timeoutMs: 1 },
      browserType,
    );

    await surface.open();
    const resolved = await surface.resolveTarget({
      locators: [
        { type: "role", role: "textbox", name: "Member ID" },
        { type: "label", text: "Member ID" },
      ],
    });

    expect(attempts).toEqual(["role", "label"]);
    expect(resolved).toBeDefined();
    await surface.close();
  });
});

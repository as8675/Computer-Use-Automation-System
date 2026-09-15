import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CapabilityArtifactSchema,
  type CapabilityArtifact,
} from "../src/artifacts/schema.js";
import {
  EvidenceLogger,
  redactInputs,
} from "../src/evidence/evidence-logger.js";

function artifact(): CapabilityArtifact {
  return CapabilityArtifactSchema.parse({
    metadata: {
      schemaVersion: "1.0.0",
      capabilityVersion: "1.0.0",
      name: "evidence-test",
      description: "Evidence logger test capability",
    },
    inputs: {
      memberId: {
        type: "string",
        required: true,
        description: "Member ID",
        sensitive: true,
      },
      includeClosed: {
        type: "boolean",
        required: false,
        description: "Include closed accounts",
        sensitive: false,
      },
    },
    outputs: {},
    steps: [
      {
        id: "wait-ready",
        type: "wait",
        risk: "safe",
        checkpoint: { type: "textVisible", text: "Ready" },
      },
    ],
    finalCheckpoint: { type: "textVisible", text: "Ready" },
  });
}

describe("EvidenceLogger", () => {
  it("redacts declared sensitive values", () => {
    expect(
      redactInputs(artifact(), {
        memberId: "12345",
        includeClosed: true,
      }),
    ).toEqual({
      memberId: "[REDACTED]",
      includeClosed: true,
    });
  });

  it("creates structured JSONL evidence without persisting secrets", async () => {
    const baseDirectory = await mkdtemp(path.join(tmpdir(), "replay-evidence-"));

    try {
      const logger = new EvidenceLogger({
        baseDirectory,
        createRunId: () => "run-123",
      });
      const run = await logger.startRun(artifact(), {
        memberId: "super-secret-member-id",
        includeClosed: false,
      });
      await run.recordStep({
        stepId: "wait-ready",
        actionType: "wait",
        status: "success",
        durationMs: 12,
        result: "completed",
      });
      await run.finish({ status: "success", outputs: {} });

      const contents = await readFile(
        path.join(baseDirectory, "run-123", "evidence.jsonl"),
        "utf8",
      );
      const events = contents
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(contents).not.toContain("super-secret-member-id");
      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({
        event: "run_started",
        runId: "run-123",
        mode: "replay",
        capability: { name: "evidence-test", version: "1.0.0" },
        inputs: { memberId: "[REDACTED]", includeClosed: false },
      });
      expect(events[1]).toMatchObject({
        event: "step_completed",
        stepId: "wait-ready",
        actionType: "wait",
        status: "success",
        durationMs: 12,
      });
      expect(events[2]).toMatchObject({
        event: "run_completed",
        status: "success",
      });
    } finally {
      await rm(baseDirectory, { recursive: true, force: true });
    }
  });
});

import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

import type { CapabilityArtifact, CapabilityStep } from "../artifacts/schema.js";
import type { ReplayInputs } from "../replay/parameter-resolution.js";
import type { ReplayResult } from "../replay/result.js";

export type EvidenceStepStatus =
  | "success"
  | "failure"
  | "blocked"
  | "business_outcome";

export type StepEvidence = {
  stepId: string;
  actionType: CapabilityStep["type"];
  status: EvidenceStepStatus;
  durationMs: number;
  result?: string;
  errorCode?: string;
};

export interface EvidenceRun {
  readonly runId: string;
  readonly runDirectory: string;
  readonly screenshotPath: string;
  recordStep(evidence: StepEvidence): Promise<void>;
  finish(result: ReplayResult, screenshotPath?: string): Promise<void>;
}

export interface EvidenceLoggerLike {
  startRun(
    artifact: CapabilityArtifact,
    inputs: ReplayInputs,
  ): Promise<EvidenceRun>;
}

export type EvidenceLoggerConfig = {
  baseDirectory?: string;
  createRunId?: () => string;
  now?: () => Date;
};

export class EvidenceLogger implements EvidenceLoggerLike {
  private readonly baseDirectory: string;
  private readonly createRunId: () => string;
  private readonly now: () => Date;

  constructor(config: EvidenceLoggerConfig = {}) {
    this.baseDirectory = path.resolve(config.baseDirectory ?? "evidence");
    this.createRunId = config.createRunId ?? randomUUID;
    this.now = config.now ?? (() => new Date());
  }

  async startRun(
    artifact: CapabilityArtifact,
    inputs: ReplayInputs,
  ): Promise<EvidenceRun> {
    const runId = this.createRunId();
    const runDirectory = path.join(this.baseDirectory, runId);
    const evidencePath = path.join(runDirectory, "evidence.jsonl");
    await mkdir(runDirectory, { recursive: true });

    const startedAt = this.now();
    await writeJsonLine(evidencePath, {
      event: "run_started",
      runId,
      mode: "replay",
      capability: {
        name: artifact.metadata.name,
        version: artifact.metadata.capabilityVersion,
      },
      startTimestamp: startedAt.toISOString(),
      inputs: redactInputs(artifact, inputs),
    });

    return new JsonlEvidenceRun(
      runId,
      runDirectory,
      evidencePath,
      artifact,
      startedAt,
      this.now,
    );
  }
}

class JsonlEvidenceRun implements EvidenceRun {
  readonly screenshotPath: string;

  constructor(
    readonly runId: string,
    readonly runDirectory: string,
    private readonly evidencePath: string,
    private readonly artifact: CapabilityArtifact,
    private readonly startedAt: Date,
    private readonly now: () => Date,
  ) {
    this.screenshotPath = path.join(runDirectory, "failure.png");
  }

  async recordStep(evidence: StepEvidence): Promise<void> {
    await writeJsonLine(this.evidencePath, {
      event: "step_completed",
      runId: this.runId,
      mode: "replay",
      capability: {
        name: this.artifact.metadata.name,
        version: this.artifact.metadata.capabilityVersion,
      },
      timestamp: this.now().toISOString(),
      ...evidence,
    });
  }

  async finish(result: ReplayResult, screenshotPath?: string): Promise<void> {
    const endedAt = this.now();
    await writeJsonLine(this.evidencePath, {
      event: "run_completed",
      runId: this.runId,
      mode: "replay",
      capability: {
        name: this.artifact.metadata.name,
        version: this.artifact.metadata.capabilityVersion,
      },
      startTimestamp: this.startedAt.toISOString(),
      endTimestamp: endedAt.toISOString(),
      durationMs: Math.max(0, endedAt.getTime() - this.startedAt.getTime()),
      status: result.status,
      result:
        result.status === "failure"
          ? undefined
          : result.status === "success"
            ? result.outputs
            : result.code,
      errorCode: result.status === "failure" ? result.error.code : undefined,
      screenshotPath,
    });
  }
}

export function redactInputs(
  artifact: CapabilityArtifact,
  inputs: ReplayInputs,
): Record<string, string | number | boolean | undefined> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, value]) => [
      name,
      artifact.inputs[name]?.sensitive ? "[REDACTED]" : value,
    ]),
  );
}

async function writeJsonLine(pathname: string, value: object): Promise<void> {
  await appendFile(pathname, `${JSON.stringify(value)}\n`, "utf8");
}

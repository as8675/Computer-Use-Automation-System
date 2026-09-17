import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PolicyEngine } from "../policy/policy-engine.js";
import { BrowserSurface } from "../surface/browser-surface.js";
import { DiscoveryAgent } from "./agent.js";
import { OpenAIDiscoveryModel } from "./openai-discovery-model.js";

const DEFAULT_MAX_STEPS = 10;

class DiscoveryCliConfigurationError extends Error {
  readonly code = "DISCOVERY_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "DiscoveryCliConfigurationError";
  }
}

async function main(): Promise<void> {
  const goal = process.argv.slice(2).join(" ").trim();
  if (!goal) {
    throw new DiscoveryCliConfigurationError(
      'A goal is required. Usage: npm run discover -- "Your goal"',
    );
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new DiscoveryCliConfigurationError(
      "OPENAI_API_KEY is required in the environment or root .env file.",
    );
  }

  const targetUrl = parseTargetUrl(process.env.DEMO_APP_URL);
  const configuredOrigins = commaSeparated(process.env.ALLOWED_ORIGINS);
  const configuredDomains = commaSeparated(process.env.ALLOWED_DOMAINS);
  const model = new OpenAIDiscoveryModel({
    apiKey,
    model: process.env.OPENAI_DISCOVERY_MODEL?.trim() || undefined,
  });
  const policy = new PolicyEngine({
    allowedOrigins:
      configuredOrigins.length > 0 ? configuredOrigins : [targetUrl.origin],
    allowedDomains: configuredDomains,
    allowedActionTypes: ["click", "fill", "extract"],
  });
  const surface = new BrowserSurface({ appUrl: targetUrl.href });
  const agent = new DiscoveryAgent({
    model,
    policy,
    surfaceFactory: () => surface,
  });

  const result = await agent.discover({
    goal,
    targetUrl: targetUrl.href,
    maxSteps: DEFAULT_MAX_STEPS,
  });

  const runId = randomUUID();
  const runDirectory = path.resolve("evidence", runId);
  const resultPath = path.join(runDirectory, "discovery-result.json");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        runId,
        mode: "discovery",
        result,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(JSON.stringify(result, null, 2));
  console.error(`Discovery trace saved to ${resultPath}`);
  if (result.status === "failure") process.exitCode = 1;
}

function parseTargetUrl(value: string | undefined): URL {
  if (!value?.trim()) {
    throw new DiscoveryCliConfigurationError(
      "DEMO_APP_URL is required in the environment or root .env file.",
    );
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(value);
  } catch {
    throw new DiscoveryCliConfigurationError(
      "DEMO_APP_URL must be a valid absolute URL.",
    );
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new DiscoveryCliConfigurationError(
      "DEMO_APP_URL must use the http or https protocol.",
    );
  }
  return targetUrl;
}

function commaSeparated(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

main().catch((error: unknown) => {
  const configurationError = error instanceof DiscoveryCliConfigurationError;
  console.error(
    JSON.stringify(
      {
        status: configurationError ? "configuration_error" : "failure",
        error: {
          code: configurationError
            ? error.code
            : "UNEXPECTED_DISCOVERY_CLI_ERROR",
          message: error instanceof Error ? error.message : "Discovery failed.",
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

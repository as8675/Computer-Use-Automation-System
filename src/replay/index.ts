import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  CapabilityArtifactSchema,
  type CapabilityArtifact,
  type InputDefinition,
} from "../artifacts/schema.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { BrowserSurface } from "../surface/browser-surface.js";
import type { ReplayInputs } from "./parameter-resolution.js";
import type { ReplayResult } from "./result.js";
import { ReplayEngine } from "./engine.js";

const [artifactArgument, ...inputArguments] = process.argv.slice(2);

if (!artifactArgument) {
  console.error(
    "Usage: npm run replay -- <capability.json> --inputName value",
  );
  process.exitCode = 1;
} else {
  const result = await runReplay(artifactArgument, inputArguments).catch(
    (error): ReplayResult => ({
      status: "failure",
      error: {
        code: "UNEXPECTED_RUNTIME_ERROR",
        message: error instanceof Error ? error.message : "Unexpected CLI error",
      },
    }),
  );

  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failure") process.exitCode = 1;
}

async function runReplay(
  artifactArgument: string,
  inputArguments: string[],
): Promise<ReplayResult> {
  const artifactPath = path.resolve(artifactArgument);
  const artifact = CapabilityArtifactSchema.parse(
    JSON.parse(await readFile(artifactPath, "utf8")),
  );
  const inputs = parseInputs(inputArguments, artifact);
  const appUrl = process.env.DEMO_APP_URL ?? "http://127.0.0.1:8080";
  const configuredOrigins = commaSeparated(process.env.ALLOWED_ORIGINS);
  const configuredDomains = commaSeparated(process.env.ALLOWED_DOMAINS);

  const surface = new BrowserSurface({ appUrl, headless: true });
  const policy = new PolicyEngine({
    allowedOrigins: configuredOrigins.length > 0 ? configuredOrigins : [appUrl],
    allowedDomains: configuredDomains,
    allowedActionTypes: ["click", "fill", "select", "extract", "wait"],
  });

  return new ReplayEngine(surface, { policy }).replay(artifact, inputs);
}

function parseInputs(
  arguments_: string[],
  artifact: CapabilityArtifact,
): ReplayInputs {
  const rawInputs: Record<string, string> = {};

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument "${argument}".`);
    }

    const equalsIndex = argument.indexOf("=");
    if (equalsIndex >= 0) {
      rawInputs[argument.slice(2, equalsIndex)] = argument.slice(equalsIndex + 1);
      continue;
    }

    const name = argument.slice(2);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for "--${name}".`);
    }
    rawInputs[name] = value;
    index += 1;
  }

  return Object.fromEntries(
    Object.entries(rawInputs).map(([name, value]) => {
      const definition = artifact.inputs[name];
      if (!definition) throw new Error(`Unknown capability input "${name}".`);
      return [name, coerceCliValue(value, definition)];
    }),
  );
}

function coerceCliValue(value: string, definition: InputDefinition) {
  switch (definition.type) {
    case "string":
    case "enum":
      return value;
    case "number": {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new Error(`Value "${value}" is not a valid number.`);
      }
      return number;
    }
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      throw new Error(`Value "${value}" must be true or false.`);
  }
}

function commaSeparated(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

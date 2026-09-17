import { describe, expect, it, vi } from "vitest";

import {
  DiscoveryModelError,
  OpenAIDiscoveryModel,
  type OpenAIDiscoveryClient,
} from "../src/discovery/openai-discovery-model.js";
import type { DiscoveryDecisionInput } from "../src/discovery/schema.js";

const decisionInput: DiscoveryDecisionInput = {
  goal: "Look up a member",
  currentUrl: "http://example.test/members",
  visibleText: "Member Search",
  interactiveControls: [
    {
      role: "textbox",
      accessibleName: "Member ID",
      label: "Member ID",
    },
  ],
  previousActions: [],
};

function mockClient(output: unknown): OpenAIDiscoveryClient {
  return {
    responses: {
      create: vi.fn().mockResolvedValue({ output_text: JSON.stringify(output) }),
    },
  };
}

describe("OpenAIDiscoveryModel", () => {
  it("parses a valid model response", async () => {
    const action = {
      type: "click",
      target: {
        locators: [{ type: "role", role: "button", name: "Search" }],
      },
    } as const;
    const client = mockClient({ action });
    const model = new OpenAIDiscoveryModel({
      client,
      model: "test-model",
    });

    await expect(model.decide(decisionInput)).resolves.toEqual(action);
    expect(client.responses.create).toHaveBeenCalledOnce();
  });

  it("rejects an invalid action with a structured model error", async () => {
    const model = new OpenAIDiscoveryModel({
      client: mockClient({
        action: { type: "navigate", url: "https://example.test" },
      }),
      model: "test-model",
    });

    await expect(model.decide(decisionInput)).rejects.toEqual(
      expect.objectContaining<Partial<DiscoveryModelError>>({
        code: "INVALID_MODEL_RESPONSE",
        name: "DiscoveryModelError",
      }),
    );
  });

  it("reports a missing API key cleanly", () => {
    expect(
      () => new OpenAIDiscoveryModel({ apiKey: "", model: "test-model" }),
    ).toThrow(
      expect.objectContaining<Partial<DiscoveryModelError>>({
        code: "MISSING_API_KEY",
        name: "DiscoveryModelError",
      }),
    );
  });
});

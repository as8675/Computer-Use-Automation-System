import { describe, expect, it } from "vitest";
import type { BrowserType } from "playwright";

import { BrowserSurface } from "../src/surface/browser-surface.js";

describe("BrowserSurface.observe", () => {
  it("returns compact page text and serializable interactive controls", async () => {
    const bodyLocator = {
      innerText: async () => "  Member Search\n\n Enter a member ID  ",
    };
    const controlsLocator = {
      evaluateAll: async () => [
        {
          role: "textbox",
          accessibleName: "Member ID",
          label: "Member ID",
        },
        {
          role: "button",
          accessibleName: "Search",
          visibleText: "Search",
        },
        {
          role: "link",
          accessibleName: "Help",
          visibleText: "Help",
          disabled: true,
        },
      ],
    };
    const page = {
      goto: async () => undefined,
      url: () => "http://example.test/members",
      locator: (selector: string) =>
        selector === "body" ? bodyLocator : controlsLocator,
    };
    const browser = {
      newPage: async () => page,
      close: async () => undefined,
    };
    const browserType = {
      launch: async () => browser,
    } as unknown as BrowserType;
    const surface = new BrowserSurface(
      { appUrl: "http://example.test" },
      browserType,
    );

    await surface.open();
    const observation = await surface.observe();

    expect(observation).toEqual({
      currentUrl: "http://example.test/members",
      visibleText: "Member Search Enter a member ID",
      interactiveControls: [
        {
          role: "textbox",
          accessibleName: "Member ID",
          label: "Member ID",
        },
        {
          role: "button",
          accessibleName: "Search",
          visibleText: "Search",
        },
        {
          role: "link",
          accessibleName: "Help",
          visibleText: "Help",
          disabled: true,
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(observation))).toEqual(observation);
    await surface.close();
  });
});

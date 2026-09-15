import {
  chromium,
  type Browser,
  type BrowserType,
  type Locator,
  type Page,
} from "playwright";

import type {
  Checkpoint,
  ControlTarget,
  LocatorStrategy,
} from "../artifacts/schema.js";
import {
  AutomationError,
  AutomationErrorCode,
} from "./automation-error.js";

export type BrowserSurfaceConfig = {
  appUrl: string;
  headless?: boolean;
  timeoutMs?: number;
};

export interface ReplaySurface {
  open(): Promise<void>;
  click(target: ControlTarget): Promise<void>;
  fill(target: ControlTarget, value: string): Promise<void>;
  select(target: ControlTarget, value: string): Promise<void>;
  extractText(target: ControlTarget): Promise<string>;
  evaluateCheckpoint(checkpoint: Checkpoint, timeoutMs?: number): Promise<boolean>;
  captureScreenshot(path: string): Promise<void>;
  close(): Promise<void>;
}

export class BrowserSurface implements ReplaySurface {
  private browser?: Browser;
  private page?: Page;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: BrowserSurfaceConfig,
    private readonly browserType: BrowserType = chromium,
  ) {
    this.timeoutMs = config.timeoutMs ?? 5_000;
  }

  async open(): Promise<void> {
    this.browser = await this.browserType.launch({
      headless: this.config.headless ?? true,
    });
    this.page = await this.browser.newPage();
    await this.page.goto(this.config.appUrl, { waitUntil: "networkidle" });
  }

  async resolveTarget(
    target: ControlTarget,
    timeoutMs = this.timeoutMs,
  ): Promise<Locator> {
    const page = this.requirePage();

    for (const strategy of target.locators) {
      const locator = this.createLocator(page, strategy).first();
      try {
        if (timeoutMs === 0) {
          if (!(await locator.isVisible())) continue;
        } else {
          await locator.waitFor({ state: "visible", timeout: timeoutMs });
        }
        return locator;
      } catch {
        // Continue only through the explicitly declared fallback list.
      }
    }

    throw new AutomationError(
      AutomationErrorCode.LOCATOR_NOT_FOUND,
      `Unable to resolve target${target.description ? ` "${target.description}"` : ""}.`,
      {
        expected: JSON.stringify(target.locators),
        observed: "No declared locator resolved to a visible control",
      },
    );
  }

  async click(target: ControlTarget): Promise<void> {
    await (await this.resolveTarget(target)).click();
  }

  async fill(target: ControlTarget, value: string): Promise<void> {
    await (await this.resolveTarget(target)).fill(value);
  }

  async select(target: ControlTarget, value: string): Promise<void> {
    await (await this.resolveTarget(target)).selectOption(value);
  }

  async extractText(target: ControlTarget): Promise<string> {
    const text = await (await this.resolveTarget(target)).textContent();
    return text?.trim() ?? "";
  }

  async evaluateCheckpoint(
    checkpoint: Checkpoint,
    timeoutMs = this.timeoutMs,
  ): Promise<boolean> {
    const page = this.requirePage();

    try {
      switch (checkpoint.type) {
        case "textVisible": {
          const locator = page
            .getByText(checkpoint.text, { exact: false })
            .first();
          if (timeoutMs === 0) return locator.isVisible();
          await locator.waitFor({ state: "visible", timeout: timeoutMs });
          return true;
        }
        case "urlMatches":
          return new RegExp(checkpoint.pattern).test(page.url());
        case "elementVisible":
          await this.resolveTarget(checkpoint.target, timeoutMs);
          return true;
      }
    } catch {
      return false;
    }
  }

  async captureScreenshot(path: string): Promise<void> {
    await this.requirePage().screenshot({ path, fullPage: true });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new AutomationError(
        AutomationErrorCode.UNEXPECTED_RUNTIME_ERROR,
        "BrowserSurface must be opened before it can be used.",
      );
    }
    return this.page;
  }

  private createLocator(page: Page, strategy: LocatorStrategy): Locator {
    switch (strategy.type) {
      case "role":
        return page.getByRole(
          strategy.role as Parameters<Page["getByRole"]>[0],
          { name: strategy.name, exact: true },
        );
      case "label":
        return page.getByLabel(strategy.text, { exact: true });
      case "text":
        return page.getByText(strategy.text, { exact: true });
      case "css":
        return page.locator(strategy.selector);
    }
  }
}

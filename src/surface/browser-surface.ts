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
import type { DiscoveryObservation } from "../discovery/schema.js";
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
  readonly targetUrl: string;
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

  get targetUrl(): string {
    return this.config.appUrl;
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
    const locator = await this.resolveTarget(target);
    await locator.click();
    await this.waitForClickedControl(locator);
  }

  async fill(target: ControlTarget, value: string): Promise<void> {
    await (await this.resolveTarget(target)).fill(value);
  }

  async select(target: ControlTarget, value: string): Promise<void> {
    await (await this.resolveTarget(target)).selectOption(value);
  }

  async extractText(target: ControlTarget): Promise<string> {
    const text = await (await this.resolveTarget(target)).innerText();
    return compactText(text, 6_000);
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

  async observe(): Promise<DiscoveryObservation> {
    const page = this.requirePage();
    const visibleText = compactText(await page.locator("body").innerText(), 6_000);
    const controls = await page
      .locator("button, input:not([type='hidden']), a[href], select")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = window.getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              bounds.width > 0 &&
              bounds.height > 0
            );
          })
          .slice(0, 100)
          .map((element) => {
            const tagName = element.tagName.toLowerCase();
            const inputType =
              element instanceof HTMLInputElement
                ? element.type.toLowerCase()
                : undefined;
            const role =
              element.getAttribute("role") ||
              (tagName === "a"
                ? "link"
                : tagName === "select"
                  ? "combobox"
                  : tagName === "button" ||
                      ["button", "submit", "reset"].includes(inputType ?? "")
                    ? "button"
                    : inputType === "checkbox"
                      ? "checkbox"
                      : inputType === "radio"
                        ? "radio"
                        : "textbox");
            const labels = (
              element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement
            ).labels;
            const label =
              labels?.length
                ? Array.from(labels)
                    .map((item) => item.textContent?.trim() ?? "")
                    .filter(Boolean)
                    .join(" ")
                : undefined;
            const labelledBy = element
              .getAttribute("aria-labelledby")
              ?.split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim())
              .filter((text): text is string => Boolean(text))
              .join(" ");
            const visibleText =
              element instanceof HTMLElement
                ? element.innerText.trim()
                : element.textContent?.trim();
            const accessibleName =
              element.getAttribute("aria-label")?.trim() ||
              labelledBy ||
              label ||
              visibleText ||
              (element instanceof HTMLInputElement
                ? element.getAttribute("title")?.trim() || undefined
                : undefined);
            const disabled =
              ("disabled" in element && Boolean(element.disabled)) ||
              element.getAttribute("aria-disabled") === "true";

            return {
              role,
              ...(accessibleName ? { accessibleName } : {}),
              ...(label ? { label } : {}),
              ...(visibleText ? { visibleText } : {}),
              ...(disabled ? { disabled: true } : {}),
            };
          }),
      );

    return {
      currentUrl: page.url(),
      visibleText,
      interactiveControls: controls.map((control) => ({
        role: compactText(control.role, 80),
        ...(control.accessibleName
          ? { accessibleName: compactText(control.accessibleName, 160) }
          : {}),
        ...(control.label ? { label: compactText(control.label, 160) } : {}),
        ...(control.visibleText
          ? { visibleText: compactText(control.visibleText, 160) }
          : {}),
        ...(control.disabled ? { disabled: true } : {}),
      })),
    };
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
      case "text": {
        const normalizedTextPattern = strategy.text
          .trim()
          .split(/\s+/)
          .map(escapeRegularExpression)
          // Adjacent elements have no separator in textContent: for example,
          // <td>Savings</td><td>$7.00</td> becomes "Savings$7.00".
          .join("\\s*");
        return page
          .locator("*")
          .filter({ hasText: new RegExp(normalizedTextPattern, "i") })
          .last();
      }
      case "css":
        return page.locator(strategy.selector);
    }
  }

  private async waitForClickedControl(locator: Locator): Promise<void> {
    // Form submissions commonly disable their trigger while replacing page
    // content. Give that state a moment to render, then avoid observing the
    // transient loading UI as the next discovery state.
    await delay(Math.min(50, this.timeoutMs));

    const deadline = Date.now() + this.timeoutMs;
    while (await locator.isDisabled().catch(() => false)) {
      if (Date.now() >= deadline) return;
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
}

function compactText(value: string, maximumLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

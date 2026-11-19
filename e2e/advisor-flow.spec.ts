import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    webVitals: {
      onINP: (callback: (metric: { value: number }) => void, options?: { reportAllChanges?: boolean }) => void;
    };
    __events: { name: string; duration: number }[];
    __inp?: number;
    __feedbackAt?: number;
    __stepStart?: number;
  }
}

async function arm(page: Page) {
  await page.evaluate(() => {
    window.__feedbackAt = undefined;
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-pending='true']")) {
        window.__feedbackAt = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-pending"],
    });
    window.__stepStart = performance.now();
  });
}

async function step(page: Page, name: string, locator: ReturnType<Page["locator"]>) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ trial: true });
  const cursor = await page.evaluate(() => ({ events: window.__events.length, commits: window.__reactCommits?.length ?? 0 }));
  await arm(page);
  await locator.click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const timing = await page.evaluate((from) => {
    const clicks = window.__events.slice(from.events).filter((entry) => entry.name === "click");
    const inp = clicks.reduce((max, entry) => Math.max(max, entry.duration), 0);
    const feedback = window.__feedbackAt == null ? null : window.__feedbackAt - (window.__stepStart ?? window.__feedbackAt);
    const commits = (window.__reactCommits ?? []).slice(from.commits);
    const react = commits.reduce((max, entry) => Math.max(max, entry.actual), 0);
    return { inp, feedback, react };
  }, cursor);
  console.log(JSON.stringify({
    name,
    inp: Math.round(timing.inp),
    feedbackMs: timing.feedback == null ? null : Math.round(timing.feedback),
    reactMs: Math.round(timing.react),
  }));
  expect(timing.feedback, `${name} pressed state`).not.toBeNull();
  expect(timing.feedback ?? 999, `${name} pressed state`).toBeLessThan(100);
  expect(timing.inp, `${name} INP`).toBeLessThanOrEqual(200);
}

test("H265 clicks stay under 200ms", async ({ page }) => {
  await page.addInitScript(() => {
    window.__events = [];
    window.__profile = true;
    window.__reactCommits = [];
    window.print = () => {
      window.__printed = true;
    };
    const options = { type: "event" as const, durationThreshold: 16, buffered: true };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__events.push({ name: entry.name, duration: entry.duration });
      }
    }).observe(options);
  });

  await page.goto("/opportunities");
  await page.addScriptTag({ path: "node_modules/web-vitals/dist/web-vitals.iife.js" });
  await page.evaluate(() => {
    window.webVitals.onINP((metric) => {
      window.__inp = metric.value;
    }, { reportAllChanges: true });
  });

  const household = page.getByRole("link", { name: "Morgan, Hiroshi and Sara" });
  await step(page, "Open H265", household);
  await page.getByRole("button", { name: /Continue case|Start case/ }).waitFor();

  const openCase = page.getByRole("button", { name: /Continue case|Start case/ });
  await step(page, "Continue case", openCase);
  await page.getByRole("checkbox", { name: /^Compare / }).first().waitFor();

  const boxes = page.getByRole("checkbox", { name: /^Compare / });
  for (let index = 0; index < 3; index += 1) {
    const box = boxes.nth(index);
    await step(page, `Tick plan ${index + 1}`, box);
    await expect(page.getByRole("button", { name: new RegExp(`Compare ${index + 1}`) })).toBeVisible();
  }

  const compare = page.getByRole("button", { name: "Compare 3" });
  await step(page, "Compare", compare);
  await expect(page.getByRole("heading", { name: "Compare" })).toBeVisible();

  const card = page.locator("[data-scenario]").nth(1);
  await step(page, "Select a card", card);
  await expect(page.getByTestId("selected-plan")).toBeVisible();

  const recommend = page.getByRole("button", { name: "Mark as recommended" });
  await step(page, "Mark as recommended", recommend);
  await expect(page.getByRole("dialog").or(page.getByRole("link", { name: "Present" }))).toBeVisible();

  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    const reason = dialog.getByRole("textbox");
    if (await reason.count()) await reason.fill("Closest fit for this household");
    const ack = dialog.getByRole("checkbox");
    if (await ack.count()) await ack.click();
    const confirm = dialog.getByRole("button", { name: "Recommend this plan" });
    await step(page, "Confirm recommendation", confirm);
  }
  await expect(page.getByRole("link", { name: "Present" })).toBeVisible();

  const present = page.getByRole("link", { name: "Present" });
  await step(page, "Present", present);
  await expect(page.getByRole("button", { name: "Agreed" })).toBeVisible();

  const agreed = page.getByRole("button", { name: "Agreed" });
  await step(page, "Agreed", agreed);
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.locator("select").selectOption("servicing_call");
  const save = page.getByRole("button", { name: "Save" });
  await step(page, "Save agreement", save);
  await expect(page.getByRole("heading", { name: "Download the household's PDF" })).toBeVisible();

  const download = page.getByRole("button", { name: "Download the household's PDF" });
  await step(page, "Download PDF", download);
  await expect.poll(() => page.evaluate(() => window.__printed === true)).toBe(true);

  const inp = await page.evaluate(() => window.__inp ?? 0);
  expect(inp).toBeLessThanOrEqual(200);
});

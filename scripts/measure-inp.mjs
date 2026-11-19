import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3001";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.__events = [];
  window.__long = [];
  window.__vitals = [];
  const events = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__events.push({
        name: entry.name,
        duration: entry.duration,
        start: entry.startTime,
        processing: entry.processingEnd - entry.processingStart,
      });
    }
  });
  events.observe({ type: "event", durationThreshold: 16, buffered: true });
  const tasks = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__long.push({ duration: entry.duration, start: entry.startTime });
    }
  });
  tasks.observe({ type: "longtask", buffered: true });
});

await page.goto(`${base}/opportunities`, { waitUntil: "networkidle" });
await page.addScriptTag({ path: "node_modules/web-vitals/dist/web-vitals.iife.js" });
await page.evaluate(() => {
  webVitals.onINP((metric) => {
    window.__vitals.push({ value: metric.value, rating: metric.rating });
  }, { reportAllChanges: true });
});

const steps = [];

async function measure(name, action, ready) {
  const cursor = await page.evaluate(() => ({ events: window.__events.length, long: window.__long.length, vitals: window.__vitals.length }));
  const started = Date.now();
  await action();
  const reaction = await page.waitForFunction(ready, null, { timeout: 8000 }).then(() => Date.now() - started).catch(() => null);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
  const detail = await page.evaluate((from) => {
    const events = window.__events.slice(from.events);
    const long = window.__long.slice(from.long);
    const vitals = window.__vitals.slice(from.vitals);
    return {
      events: events.map((entry) => ({
        name: entry.name,
        duration: Math.round(entry.duration),
        processing: Math.round(entry.processing),
      })),
      long: long.map((entry) => Math.round(entry.duration)),
      vital: vitals.at(-1) ?? null,
    };
  }, cursor);
  const inp = detail.events.reduce((max, entry) => Math.max(max, entry.duration), 0);
  steps.push({
    name,
    inp,
    reactionMs: reaction,
    longTasks: detail.long,
    events: detail.events,
    vital: detail.vital,
  });
  console.log(JSON.stringify(steps.at(-1)));
}

const household = page.getByRole("link", { name: "Morgan, Hiroshi and Sara" });
await household.waitFor();
await measure(
  "Open H265",
  () => household.click(),
  () => document.body.textContent?.includes("Continue case") || document.body.textContent?.includes("Start case"),
);

await measure(
  "Continue case",
  () => page.getByRole("button", { name: /Continue case|Start case/ }).click(),
  () => document.body.textContent?.includes("Scenarios"),
);

const boxes = page.getByRole("checkbox", { name: /^Compare / });
for (let index = 0; index < 3; index += 1) {
  await measure(
    `Tick plan ${index + 1}`,
    () => boxes.nth(index).click(),
    () => document.body.textContent?.includes(`Compare ${index + 1}`),
  );
}

await measure(
  "Compare",
  () => page.getByRole("button", { name: /^Compare 3/ }).click(),
  () => document.querySelector("h1")?.textContent === "Compare",
);

await measure(
  "Select a card",
  () => page.locator("[data-scenario]").nth(1).click(),
  () => document.querySelector("[data-testid='selected-plan']") != null,
);

await measure(
  "Mark as recommended",
  () => page.getByRole("button", { name: "Mark as recommended" }).click(),
  () => document.body.textContent?.includes("Plan recommended") || document.body.textContent?.includes("Mark as recommended") && document.querySelector("[role='dialog']") != null || document.body.textContent?.includes("Present"),
);

if (await page.getByRole("dialog").count()) {
  const reason = page.getByRole("textbox");
  if (await reason.count()) await reason.fill("Closest fit for this household");
  const ack = page.getByRole("checkbox");
  if (await ack.count()) await ack.click();
  await measure(
    "Confirm recommendation",
    () => page.getByRole("button", { name: "Recommend this plan" }).click(),
    () => document.body.textContent?.includes("Present"),
  );
}

await measure(
  "Present",
  () => page.getByRole("link", { name: "Present" }).click(),
  () => document.body.textContent?.includes("Your recommended plan"),
);

await measure(
  "Agreed",
  () => page.getByRole("button", { name: "Agreed" }).click(),
  () => document.body.textContent?.includes("Record the answer"),
);

await page.locator("select").selectOption("servicing_call");
await measure(
  "Save agreement",
  () => page.getByRole("button", { name: "Save" }).click(),
  () => document.body.textContent?.includes("Download the household"),
);

await page.evaluate(() => {
  window.print = () => {
    window.__printed = true;
  };
});
await measure(
  "Download PDF",
  () => page.getByRole("button", { name: "Download the household's PDF" }).click(),
  () => window.__printed === true,
);

const summary = await page.evaluate(() => window.__vitals.at(-1) ?? null);
console.log(JSON.stringify({ summary, steps }, null, 2));
await browser.close();

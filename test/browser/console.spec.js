import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRecordedRuntime } from "../../src/evidence.js";

const proof = JSON.parse(await readFile(new URL("../../docs/sandbox-evidence.json", import.meta.url), "utf8"));
const redirect = proof.results.find((result) => result.id === "recipient-swap");

async function openDemo(page) {
  await page.goto("./");
  await expect(page.locator("#runtime-pill")).toHaveText("RECORDED");
  await expect(page.locator("#execute-button")).toBeEnabled();
}
async function mockLive(page, statusHandler) {
  const runtime = createRecordedRuntime(proof);
  const initial = await runtime.status();
  const { proof_summary, recorded, ...status } = initial;
  await page.route("**/Intent-Guard/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('data-runtime="recorded"', 'data-runtime="live"') });
  });
  await page.route("**/api/status", (route) => statusHandler(route, status));
  await page.route("**/api/scenarios", async (route) => route.fulfill({ json: await runtime.scenarios() }));
  await page.route("**/api/reset", (route) => route.fulfill({ json: status }));
}

test("the public console shows real captured receipts without sending transactions", async ({ page }) => {
  const apiCalls = [];
  const errors = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) apiCalls.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await openDemo(page);
  await expect(page.locator("#stat-blocked")).toHaveText("19");
  await expect(page.locator("#stat-decisions")).toHaveText("0.08");
  await page.locator('[data-scenario="recipient-swap"]').click();
  await expect(page.locator('[data-scenario="recipient-swap"]')).toBeFocused();
  await page.locator("#execute-button").click();
  await expect(page.locator("#decision-label")).toHaveText("REQUEST BLOCKED");
  await expect(page.locator("#transaction-hash")).toHaveText(redirect.transaction.transaction_hash);
  await expect(page.locator("#attacker-received")).toHaveText("0 NEAR");
  await expect(page.locator("#chain-logs")).toContainText("INVOICE_RECIPIENT_MISMATCH");
  await expect(page.locator("#receipt-meta")).toContainText("recorded Sandbox");
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test("the walkthrough preserves control, rejection, and valid payment for inspection", async ({ page }) => {
  await openDemo(page);
  await page.locator("#run-demo").click();
  await expect(page.locator("#execute-button")).toBeDisabled();
  await expect(page.locator("#decision-label")).toHaveText("INVOICE PAID");
  await expect(page.locator(".audit-row")).toHaveCount(3);
  await expect(page.locator('[data-demo-case="baseline"] .comparison-result')).toHaveText("0.08 NEAR lost");
  await expect(page.locator('[data-demo-case="recipient-swap"] .comparison-result')).toHaveText("0 NEAR leaked");
  await expect(page.locator('[data-demo-case="routine"] .comparison-result')).toHaveText("0.08 NEAR paid");
  await page.locator('[data-demo-case="recipient-swap"]').click();
  await expect(page.locator("#decision-label")).toHaveText("REQUEST BLOCKED");
  await expect(page.locator("#transaction-hash")).toHaveText(redirect.transaction.transaction_hash);
});

test("all 22 cases can be explored and repeats retain one original receipt", async ({ page }) => {
  await openDemo(page);
  await page.locator("#approve-button").click();
  await expect(page.locator("#run-progress")).toContainText("22 cases explored");
  await expect(page.locator(".audit-row")).toHaveCount(22);
  await page.locator('[data-scenario="recipient-swap"]').click();
  await page.locator("#execute-button").click();
  await expect(page.locator("#transaction-hash")).toHaveText(redirect.transaction.transaction_hash);
  await expect(page.locator(".audit-row")).toHaveCount(22);
  const originalTime = page.locator(".audit-row").filter({ has: page.getByRole("button", { name: "Inspect Recipient substitution receipt", exact: true }) }).locator("time");
  await expect(originalTime).toHaveAttribute("datetime", redirect.recorded_at);
  await page.locator("#clear-log").click();
  await expect(page.locator(".audit-row")).toHaveCount(0);
  await expect(page.locator(".empty-row")).toContainText("Your first receipt starts here.");
  await expect(page.locator("#stat-blocked")).toHaveText("19");
});

test("search and protocol filters remain usable with keyboard focus", async ({ page }) => {
  await openDemo(page);
  const search = page.getByRole("searchbox", { name: "Search scenarios" });
  await search.fill("recipient substitution");
  await expect(page.locator(".scenario-button")).toHaveCount(1);
  await expect(search).toBeFocused();
  await search.fill("");
  await page.locator('[data-filter="runtime"]').click();
  await expect(page.locator(".scenario-button")).toHaveCount(proof.results.filter((result) => result.transaction.layer === "runtime").length);
  await page.locator('[data-scenario="direct-transfer"]').click();
  await expect(page.locator('[data-scenario="direct-transfer"]')).toBeFocused();
  await search.fill("no-matching-case-12345");
  await expect(page.locator("#scenario-empty")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.locator(".scenario-button")).toHaveCount(22);
  await expect(search).toBeFocused();
});

test("theme preference persists and restricted storage does not break startup", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDemo(page);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#runtime-pill")).toHaveText("RECORDED");
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "getItem", { value() { throw new DOMException("Storage blocked", "SecurityError"); } });
    Object.defineProperty(Storage.prototype, "setItem", { value() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await page.reload();
  await expect(page.locator("#execute-button")).toBeEnabled();
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

test("proof download contains the original complete evidence", async ({ page }) => {
  await openDemo(page);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-report").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("intentguard-near-proof.json");
  const contents = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(contents).toEqual(proof);
});

test("an unavailable evidence bundle shows a working retry instead of simulated results", async ({ page }) => {
  let reads = 0;
  await page.route("**/data/proof.json", async (route) => {
    reads += 1;
    if (reads === 1) { const broken = structuredClone(proof); broken.summary.cases_verified = 0; await route.fulfill({ json: broken }); }
    else await route.fulfill({ json: proof });
  });
  await page.goto("./");
  await expect(page.locator("#notice-title")).toHaveText("Unable to load the verified evidence");
  await expect(page.locator("#execute-button")).toBeDisabled();
  await page.locator("#retry-connection").click();
  await expect(page.locator("#runtime-pill")).toHaveText("RECORDED");
  await expect(page.locator("#execute-button")).toBeEnabled();
  expect(reads).toBe(2);
});

test("a failed live startup can reconnect and enable the console", async ({ page }) => {
  let reads = 0;
  let resets = 0;
  await mockLive(page, (route, status) => {
    reads += 1;
    return route.fulfill({ json: reads === 1 ? { ready: false, error: "The NEAR node is unavailable." } : status });
  });
  await page.route("**/api/reset", async (route) => {
    resets += 1;
    const status = await createRecordedRuntime(proof).status();
    await route.fulfill({ json: status });
  });
  await page.goto("./");
  await expect(page.locator("#notice-description")).toHaveText("The NEAR node is unavailable.");
  await expect(page.locator("#run-demo")).toBeDisabled();
  await expect(page.locator("#retry-connection")).toHaveText("Restart sandbox");
  await page.locator("#retry-connection").click();
  await expect(page.locator("#runtime-pill")).toHaveText("LIVE RUNTIME");
  await expect(page.locator("#execute-button")).toBeEnabled();
  expect(reads).toBe(1);
  expect(resets).toBe(1);
});

test("a lost live response blocks resubmission until existing receipts are refreshed", async ({ page }) => {
  let runs = 0;
  let resets = 0;
  await mockLive(page, (route, status) => route.fulfill({ json: {
    ...status, vault: runs ? redirect.after.vault : status.vault, results: runs ? [redirect] : [],
  } }));
  await page.route("**/api/reset", async (route) => { resets += 1; await route.abort("failed"); });
  await page.route("**/api/run", async (route) => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.abort("failed");
  });
  await page.goto("./");
  await expect(page.locator("#runtime-pill")).toHaveText("LIVE RUNTIME");
  await page.locator("#execute-button").click();
  await expect(page.locator("#decision-label")).toHaveText("SUBMITTING TO NEAR");
  await expect(page.locator("#execute-button")).toBeDisabled();
  await expect(page.locator("#decision-label")).toHaveText("CONNECTION INTERRUPTED");
  await expect(page.locator("#execute-button")).toBeDisabled();
  await expect(page.locator("#notice-description")).toContainText("request may have run");
  await page.locator("#retry-connection").click();
  await expect(page.locator("#execute-button")).toBeEnabled();
  await expect(page.locator("#transaction-hash")).toHaveText(redirect.transaction.transaction_hash);
  await expect(page.locator(".audit-row")).toHaveCount(1);
  expect(runs).toBe(1);
  expect(resets).toBe(0);
});

test("the interface fits phones, tablets, and wide desktops in both themes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Viewport checks run once.");
  await openDemo(page);
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.getByRole("button", { name: "Switch to light theme" }).click();
    for (const width of [320, 375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const dimensions = await page.evaluate(() => ({
        width: window.innerWidth, content: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1
          && !element.closest(".audit-table-wrap")).slice(0, 8).map((element) => element.tagName + "." + [...element.classList].join(".")),
      }));
      expect(dimensions.content, `${theme} layout at ${width}px: ${dimensions.overflowing.join(", ")}`).toBeLessThanOrEqual(dimensions.width);
      const title = await page.locator("h1").boundingBox();
      expect(title.x + title.width).toBeLessThanOrEqual(width);
    }
  }
});

test("desktop and mobile visual review artifacts", async ({ page }, testInfo) => {
  await openDemo(page);
  await page.screenshot({ path: testInfo.outputPath("console-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.screenshot({ path: testInfo.outputPath("console-light.png"), fullPage: true });
});

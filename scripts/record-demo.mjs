import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Capture actual interactions with the recorded console; never manufacture outcomes.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(root, option("--output", "artifacts/submission"));
const remote = option("--url", null);
const url = remote ?? "http://127.0.0.1:4180/Intent-Guard/";
const encoder = option("--ffmpeg", process.env.FFMPEG_PATH ?? "ffmpeg");
await mkdir(output, { recursive: true });
let preview;
let browser;

function run(executable, parameters) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, parameters, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited with ${code}`)));
  });
}

try {
  if (!remote) {
    preview = spawn(process.execPath, ["server/preview.mjs", "--port", "4180", "--base-path", "/Intent-Guard/"], { cwd: root, stdio: "inherit" });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (preview.exitCode !== null) throw new Error("The preview server could not start.");
      try { ready = (await fetch(url)).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("Build the public demo with npm run build:web first.");
  }

  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce",
    recordVideo: { dir: output, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator("#runtime-pill")).toHaveText("RECORDED");
  await expect(page.locator("#execute-button")).toBeEnabled();
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.evaluate(() => document.fonts.ready);

  async function caption(title, description) {
    console.log(title);
    await page.evaluate(({ title, description }) => {
      let panel = document.getElementById("demo-caption-overlay");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "demo-caption-overlay";
        panel.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:1000;padding:18px 36px;background:#000;border-top:2px solid #f3ca20;color:#f5f3eb;font:16px/1.5 'DM Sans',sans-serif;pointer-events:none;display:flex;align-items:center;gap:24px;";
        const heading = document.createElement("strong");
        heading.style.cssText = "color:#f3ca20;font-size:20px;white-space:nowrap;";
        const text = document.createElement("span");
        const label = document.createElement("span");
        label.textContent = "RECORDED NEAR SANDBOX";
        label.style.cssText = "margin-left:auto;flex:0 0 auto;color:#aaa;font:11px monospace;";
        panel.append(heading, text, label);
        document.body.append(panel);
      }
      panel.children[0].textContent = title;
      panel.children[1].textContent = description;
    }, { title, description });
  }
  async function frame(id) {
    await page.evaluate((id) => window.scrollTo({ top: document.getElementById(id).getBoundingClientRect().top + window.scrollY - 30, behavior: "instant" }), id);
  }
  const hold = (seconds) => page.waitForTimeout(seconds * 1000);

  await caption("IntentGuard", "A spending firewall for AI payment agents. Exact invoice approvals, enforced by NEAR.");
  await hold(7);
  await page.locator("#run-demo").click();
  await expect(page.locator("#decision-label")).toHaveText("INVOICE PAID");
  await page.locator('[data-demo-case="baseline"]').click();
  await frame("attack-console");
  await caption("01 · Without the boundary", "The unrestricted wallet redirects 0.08 NEAR to the attacker.");
  await expect(page.locator("#decision-label")).toHaveText("ATTACKER WAS PAID");
  await hold(10);

  await page.locator('[data-demo-case="recipient-swap"]').click();
  await frame("attack-console");
  await caption("02 · Redirect blocked", "The vault rejects the changed recipient. The attacker receives 0 NEAR.");
  await expect(page.locator("#decision-label")).toHaveText("REQUEST BLOCKED");
  await hold(11);

  await page.locator('[data-filter="runtime"]').click();
  await page.locator('[data-scenario="direct-transfer"]').click();
  await page.locator("#execute-button").click();
  await expect(page.locator("#decision-label")).toHaveText("REQUEST BLOCKED");
  await frame("attack-console");
  await caption("03 · Bypass rejected", "NEAR rejects a raw transfer. The scoped key can only call execute_payment.");
  await hold(10);

  await page.locator('[data-demo-case="routine"]').click();
  await frame("attack-console");
  await caption("04 · Approved invoice paid", "The original vendor receives exactly 0.08 NEAR. The invoice is consumed once.");
  await expect(page.locator("#decision-label")).toHaveText("INVOICE PAID");
  await hold(10);

  await page.locator(".receipt-details summary").click();
  await frame("chain-proof");
  await caption("Inspect the evidence", "Original transaction hashes, receipt logs, key permissions, and recipient balance checks.");
  await hold(10);
  await page.locator("#approve-button").click();
  await expect(page.locator("#run-progress")).toContainText("22 cases explored");
  await frame("attack-results");
  await caption("22 verified cases", "19 blocked attacks, an unrestricted control, an approved payment, and failed-transfer recovery.");
  await hold(8);

  await page.evaluate(() => window.scrollTo(0, 0));
  await caption("Try IntentGuard", "code-kaybee.github.io/Intent-Guard/ · Built at NEAR HACKATHON");
  await page.screenshot({ path: resolve(output, "intentguard-demo-cover.png") });
  await hold(6);
  const video = page.video();
  await context.close();
  const webm = resolve(output, "intentguard-demo.webm");
  await video.saveAs(webm);
  await video.delete();
  console.log(`Recording saved: ${webm}`);
  try {
    await run(encoder, ["-y", "-i", webm, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", resolve(output, "intentguard-demo.mp4")]);
    console.log(`X-ready video: ${resolve(output, "intentguard-demo.mp4")}`);
  } catch (error) {
    console.error(`WebM saved; MP4 conversion failed: ${error.message}. Rerun with --ffmpeg /path/to/ffmpeg.`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  preview?.kill("SIGTERM");
}

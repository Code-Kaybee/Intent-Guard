import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(root, option("--output", "artifacts/submission/guided"));
const manifest = JSON.parse(await readFile(resolve(output, "narration-manifest.json"), "utf8"));
const encoder = option("--ffmpeg", process.env.FFMPEG_PATH ?? "ffmpeg");
const remote = option("--url", null);
const url = remote ?? "http://127.0.0.1:4181/Intent-Guard/";
await mkdir(resolve(output, "frames"), { recursive: true });
let browser;
let preview;
let previewError;
const timeline = [];

function run(executable, parameters, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, parameters, { cwd: root, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let text = "";
    child.stdout?.on("data", (chunk) => { text += chunk; });
    child.stderr?.on("data", (chunk) => { text += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(text) : reject(new Error(`${executable} exited with ${code}\n${text.slice(-2500)}`)));
  });
}
const subtitleTime = (seconds) => new Date(Math.max(0, Math.round(seconds * 1000))).toISOString().slice(11, 23).replace(".", ",");

try {
  if (!remote) {
    preview = spawn(process.execPath, ["server/preview.mjs", "--port", "4181", "--base-path", "/Intent-Guard/"], { cwd: root, stdio: "inherit" });
    preview.once("error", (error) => { previewError = error; });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (previewError) throw previewError;
      if (preview.exitCode !== null) throw new Error("Preview could not start.");
      try { ready = (await fetch(url)).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("Run npm run build:web first.");
  }
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce",
    recordVideo: { dir: output, size: { width: 1600, height: 1000 } },
  });
  const page = await context.newPage();
  const epoch = performance.now();
  const elapsed = () => (performance.now() - epoch) / 1000;
  await page.goto(url);
  await expect(page.locator("#runtime-pill")).toHaveText("RECORDED");
  await expect(page.locator("#execute-button")).toBeEnabled();
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const bar = document.createElement("div");
    bar.id = "tour-bar";
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:10000;height:136px;padding:16px 32px;background:#000;border-top:3px solid #f3ca20;color:#f5f3eb;font-family:'DM Sans',sans-serif;pointer-events:none;box-sizing:border-box;";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:9px;";
    const title = document.createElement("strong");
    title.id = "tour-title"; title.style.cssText = "font-size:21px;color:#f3ca20;";
    const source = document.createElement("span");
    source.id = "tour-source"; source.style.cssText = "font:12px monospace;color:#aaa;";
    header.append(title, source);
    const caption = document.createElement("div");
    caption.id = "tour-caption"; caption.style.cssText = "font-size:27px;line-height:1.35;max-width:1500px;";
    bar.append(header, caption); document.body.append(bar);
    const cursor = document.createElement("div");
    cursor.id = "tour-cursor";
    cursor.style.cssText = "position:fixed;left:1450px;top:800px;z-index:10002;width:36px;height:36px;border:3px solid #f3ca20;border-radius:50%;background:#f3ca2026;pointer-events:none;box-shadow:0 0 0 4px #0008;transform:translate(-50%,-50%);";
    document.body.append(cursor);
    document.addEventListener("mousemove", (event) => { cursor.style.left = event.clientX + "px"; cursor.style.top = event.clientY + "px"; });
    document.addEventListener("mousedown", () => cursor.animate([{ scale: 1, background: "#f3ca2026" }, { scale: 1.4, background: "#f3ca20aa" }, { scale: 1, background: "#f3ca2026" }], { duration: 450 }));
    window.tourTimers = [];
  });

  async function frame(id, inset = 24) {
    await page.evaluate(({ id, inset }) => window.scrollTo({ top: document.getElementById(id).getBoundingClientRect().top + window.scrollY - inset, behavior: "instant" }), { id, inset });
  }
  async function click(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await page.waitForTimeout(220);
    await locator.click();
  }
  async function scene(id, action = async () => {}) {
    const index = manifest.scenes.findIndex((entry) => entry.id === id);
    const speech = manifest.scenes[index];
    if (!speech) throw new Error(`Missing narration for ${id}.`);
    const started = elapsed();
    timeline.push({ ...speech, start: started });
    console.log(`${id}: ${started.toFixed(2)}s · ${speech.duration.toFixed(2)}s narration`);
    await page.evaluate(({ speech, index, total }) => {
      window.tourTimers.forEach(clearTimeout);
      document.getElementById("tour-title").textContent = speech.id === "close" ? "Try IntentGuard · code-kaybee.github.io/Intent-Guard/" : speech.title;
      document.getElementById("tour-source").textContent = `${String(index + 1).padStart(2, "0")} / ${total} · RECORDED NEAR SANDBOX · AI NARRATION`;
      const caption = document.getElementById("tour-caption");
      caption.textContent = speech.cues[0]?.text ?? speech.narration;
      window.tourTimers = speech.cues.map((cue) => setTimeout(() => { caption.textContent = cue.text; }, cue.start * 1000));
    }, { speech, index, total: manifest.scenes.length });
    const at = async (seconds) => page.waitForTimeout(Math.max(0, (started + seconds - elapsed()) * 1000));
    await action(at);
    await at(speech.duration + 0.55);
    await page.screenshot({ path: resolve(output, `frames/${String(index + 1).padStart(2, "0")}-${id}.png`) });
  }

  await scene("hook");
  await scene("start", async (at) => {
    await at(1.2); await click(page.locator("#run-demo"));
    await expect(page.locator("#decision-label")).toHaveText("INVOICE PAID");
    await frame("demo-comparison", 60);
  });
  await scene("control", async (at) => {
    await at(0.8); await click(page.locator('[data-demo-case="baseline"]'));
    await frame("attack-console");
    await expect(page.locator("#decision-label")).toHaveText("ATTACKER WAS PAID");
  });
  await scene("redirect", async (at) => {
    await at(0.8); await click(page.locator('[data-demo-case="recipient-swap"]'));
    await frame("attack-console");
    await expect(page.locator("#decision-label")).toHaveText("REQUEST BLOCKED");
  });
  await scene("approved", async (at) => {
    await at(0.8); await click(page.locator('[data-demo-case="routine"]'));
    await frame("attack-console");
    await expect(page.locator("#decision-label")).toHaveText("INVOICE PAID");
  });
  await scene("protocol", async (at) => {
    await at(1.2); await click(page.locator('[data-filter="runtime"]'));
    await at(2.8); await click(page.locator('[data-scenario="direct-transfer"]'));
    await at(4.4); await click(page.locator("#execute-button"));
    await expect(page.locator("#decision-label")).toHaveText("REQUEST BLOCKED");
    await frame("attack-console");
  });
  await scene("policy", async (at) => {
    await at(0.8); await click(page.locator("#policy-nav"));
    await frame("chain-proof");
    await at(5); await click(page.locator(".receipt-details summary"));
  });
  await scene("search", async (at) => {
    await at(0.7); await click(page.locator('.workspace-nav a[href="#attack-console"]'));
    await click(page.locator('[data-filter="all"]'));
    await click(page.locator("#scenario-search"));
    await page.locator("#scenario-search").pressSequentially("replay", { delay: 100 });
    await at(3.4); await click(page.locator('[data-scenario="replay"]'));
    await click(page.locator("#execute-button"));
    await expect(page.locator("#decision-label")).toHaveText("REQUEST BLOCKED");
    await frame("attack-console");
  });
  await scene("suite", async (at) => {
    await at(1.0); await click(page.locator("#approve-button"));
    await expect(page.locator("#run-progress")).toContainText("22 cases explored");
    await at(3.5); await click(page.locator('.workspace-nav a[href="#attack-results"]'));
    await frame("attack-results", 70);
    await expect(page.locator(".audit-row")).toHaveCount(22);
  });
  await scene("download", async (at) => {
    await frame("chain-proof");
    await at(0.9);
    const downloaded = page.waitForEvent("download");
    await click(page.locator("#download-report"));
    const file = await downloaded;
    await file.saveAs(resolve(output, "intentguard-near-proof.json"));
    const report = JSON.parse(await readFile(resolve(output, "intentguard-near-proof.json"), "utf8"));
    if (report.summary.cases_verified !== 22 || report.summary.attacks_blocked !== 19) throw new Error("The downloaded evidence is incomplete.");
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await scene("close");
  const end = elapsed();
  await page.screenshot({ path: resolve(output, "intentguard-guided-cover.png") });
  const video = page.video();
  await context.close();
  const raw = resolve(output, "intentguard-guided-raw.webm");
  await video.saveAs(raw); await video.delete();
  await browser.close(); browser = null;

  const beginning = timeline[0].start;
  const duration = end - beginning;
  let cueCount = 0;
  const subtitles = timeline.flatMap((entry) => entry.cues.map((cue) => `${++cueCount}\n${subtitleTime(entry.start - beginning + cue.start)} --> ${subtitleTime(entry.start - beginning + cue.end)}\n${cue.text}\n`)).join("\n");
  await writeFile(resolve(output, "intentguard-guided.srt"), subtitles);
  await writeFile(resolve(output, "recording-timeline.json"), JSON.stringify({ duration, trimStart: beginning, scenes: timeline }, null, 2));
  const inputs = timeline.flatMap((scene) => ["-i", resolve(output, scene.audio)]);
  const filters = timeline.map((scene, index) => `[${index + 1}:a]adelay=${Math.round((scene.start - beginning) * 1000)}:all=1[a${index}]`);
  filters.push(`${timeline.map((_, index) => `[a${index}]`).join("")}amix=inputs=${timeline.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7,apad[narration]`);
  const final = resolve(output, "intentguard-guided-demo.mp4");
  await run(encoder, ["-hide_banner", "-loglevel", "warning", "-y", "-ss", beginning.toFixed(3), "-i", raw, ...inputs,
    "-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[narration]", "-t", duration.toFixed(3),
    "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", final]);
  await run(encoder, ["-hide_banner", "-loglevel", "warning", "-y", "-i", final, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", resolve(output, "intentguard-narration.mp3")]);
  console.log(`Guided demo complete: ${final} · ${duration.toFixed(1)} seconds`);
} finally {
  await browser?.close();
  preview?.kill("SIGTERM");
}

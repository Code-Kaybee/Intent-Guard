import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(root, option("--output", "artifacts/submission/guided"));
const encoder = option("--ffmpeg", process.env.FFMPEG_PATH ?? "ffmpeg");
const timeline = JSON.parse(await readFile(resolve(output, "recording-timeline.json"), "utf8"));
const selected = new Set(["hook", "start", "control", "redirect", "approved", "download", "close"]);
const cuts = timeline.scenes.flatMap((scene, index) => selected.has(scene.id) ? [{
  ...scene,
  from: scene.start - timeline.trimStart,
  to: index + 1 < timeline.scenes.length ? timeline.scenes[index + 1].start - timeline.trimStart : timeline.duration,
}] : []);
if (cuts.length !== selected.size) throw new Error("Missing scenes for the judge cut.");
const filters = cuts.flatMap((cut, index) => [
  `[0:v]trim=start=${cut.from.toFixed(3)}:end=${cut.to.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
  `[0:a]atrim=start=${cut.from.toFixed(3)}:end=${cut.to.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`,
]);
filters.push(`${cuts.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${cuts.length}:v=1:a=1[edited][audio]`);
// Replace only the tour's step counter; leave the actual app and evidence untouched.
const labelPath = resolve(output, "judge-source-label.ass");
await writeFile(labelPath, `[Script Info]\nScriptType: v4.00+\nPlayResX: 1600\nPlayResY: 1000\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Source,DejaVu Sans Mono,14,&H00AAAAAA,&H00AAAAAA,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,9,32,32,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:10:00.00,Source,,0,0,0,,{\\an9\\pos(1568,889)}RECORDED NEAR SANDBOX · AI NARRATION\n`);
filters.push(`[edited]drawbox=x=1000:y=ih-126:w=600:h=39:color=black:t=fill,ass=filename='${labelPath}'[video]`);
await new Promise((resolve, reject) => {
  const child = spawn(encoder, ["-hide_banner", "-loglevel", "warning", "-y", "-i", resolvePath("intentguard-guided-demo.mp4"),
    "-filter_complex", filters.join(";"), "-map", "[video]", "-map", "[audio]", "-c:v", "libx264", "-preset", "fast", "-crf", "19",
    "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", resolvePath("intentguard-judges-demo.mp4")], { stdio: "inherit" });
  child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Encoder exited with ${code}.`)));
});
function resolvePath(name) { return resolve(output, name); }
const stamp = (seconds) => new Date(Math.max(0, Math.round(seconds * 1000))).toISOString().slice(11, 23).replace(".", ",");
let offset = 0;
let index = 0;
const subtitles = [];
for (const cut of cuts) {
  for (const cue of cut.cues) subtitles.push(`${++index}\n${stamp(offset + cue.start)} --> ${stamp(offset + cue.end)}\n${cue.text}\n`);
  offset += cut.to - cut.from;
}
await writeFile(resolvePath("intentguard-judges.srt"), subtitles.join("\n"));
await writeFile(resolvePath("judges-transcript.txt"), cuts.map((cut) => cut.narration.replaceAll("Intent Guard", "IntentGuard")).join("\n\n") + "\n");
console.log(`Judge cut complete: ${offset.toFixed(1)} seconds · ${resolvePath("intentguard-judges-demo.mp4")}`);

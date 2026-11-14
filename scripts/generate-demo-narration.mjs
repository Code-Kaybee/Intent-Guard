import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Optional media tooling: Kokoro is installed separately, never into the application.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(root, option("--output", "artifacts/submission/guided"));
const voice = option("--voice", "af_heart");
const speed = Number(option("--speed", "1.04"));
const modulePath = option("--module", null);
const { KokoroTTS } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "kokoro-js");
const story = JSON.parse(await readFile(new URL("../docs/demo-storyboard.json", import.meta.url), "utf8"));
await mkdir(resolve(output, "audio"), { recursive: true });

console.log("Loading local narration model…");
const tts = await KokoroTTS.from_pretrained(option("--model", "onnx-community/Kokoro-82M-v1.0-ONNX"), {
  dtype: "q8", device: "cpu",
});

function wav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buffer;
}

const manifest = { ...story, engine: "Kokoro-82M-v1.0-ONNX", voice, synthetic_voice: true, scenes: [] };
for (const scene of story.scenes) {
  const metadataPath = resolve(output, `audio/${scene.id}.json`);
  let cached;
  try { cached = JSON.parse(await readFile(metadataPath, "utf8")); } catch {}
  if (cached?.narration === scene.narration && cached.voice === voice && cached.speed === speed) {
    manifest.scenes.push({ ...cached, ...scene });
    console.log(`${scene.id}: reused ${cached.duration.toFixed(2)} seconds`);
    continue;
  }
  const sentences = scene.narration.match(/[^.!?]+[.!?]+|[^.!?]+$/g).map((text) => text.trim());
  const segments = [];
  const cues = [];
  let sampleRate;
  let count = 0;
  for (const sentence of sentences) {
    const audio = await tts.generate(sentence.replace(/\bNEAR\b/g, "near"), { voice, speed });
    sampleRate ??= audio.sampling_rate;
    if (sampleRate !== audio.sampling_rate) throw new Error("Narration sample rates differ.");
    cues.push({ start: count / sampleRate, end: (count + audio.audio.length) / sampleRate, text: sentence.replaceAll("Intent Guard", "IntentGuard") });
    segments.push(audio.audio);
    count += audio.audio.length;
    const pause = new Float32Array(Math.round(sampleRate * 0.14));
    segments.push(pause); count += pause.length;
  }
  const samples = new Float32Array(count);
  let offset = 0;
  for (const segment of segments) { samples.set(segment, offset); offset += segment.length; }
  const audio = `audio/${scene.id}.wav`;
  await writeFile(resolve(output, audio), wav(samples, sampleRate));
  const recorded = { ...scene, voice, speed, audio, duration: count / sampleRate, cues };
  await writeFile(metadataPath, JSON.stringify(recorded, null, 2));
  manifest.scenes.push(recorded);
  console.log(`${scene.id}: ${recorded.duration.toFixed(2)} seconds`);
}
await writeFile(resolve(output, "narration-manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(resolve(output, "narration.txt"), story.scenes.map((scene) => scene.narration.replaceAll("Intent Guard", "IntentGuard")).join("\n\n") + "\n");
console.log(`Narration complete: ${manifest.scenes.reduce((total, scene) => total + scene.duration, 0).toFixed(1)} seconds of speech.`);

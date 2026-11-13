import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import binaryen from "binaryen";

const root = fileURLToPath(new URL("../", import.meta.url));
const compilerPath = new URL("../target/contract-compiler/wasm32-unknown-unknown/release/intentguard_vault.wasm", import.meta.url);
const outputDirectory = new URL("../target/near/", import.meta.url);
const wasmPath = new URL("intentguard_vault.wasm", outputDirectory);
// Cargo's cached compiler output must remain raw. Normalize into a separate file.
const compiler = spawn("cargo", ["build", "--locked", "--target-dir", "target/contract-compiler", "--target", "wasm32-unknown-unknown", "--release", "-p", "intentguard-vault"], { cwd: root, stdio: "inherit" });
await new Promise((resolve, reject) => {
  compiler.once("error", reject);
  compiler.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Contract compilation exited with code ${code}.`)));
});

const module = binaryen.readBinary(await readFile(compilerPath));
try {
  module.runPasses([
    "signext-lowering",
    "llvm-memory-copy-fill-lowering",
    "llvm-nontrapping-fptoint-lowering",
    "strip-debug",
    "strip-producers",
    "strip-target-features",
  ]);
  module.setFeatures(binaryen.Features.MVP);
  if (!module.validate()) throw new Error("The contract still contains features outside the NEAR WASM baseline.");
  binaryen.setOptimizeLevel(2);
  binaryen.setShrinkLevel(1);
  module.optimize();
  if (!module.validate()) throw new Error("The normalized contract failed WASM validation.");
  const wasm = module.emitBinary();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(wasmPath, wasm);
  console.log(`NEAR-compatible WASM: ${wasm.length} bytes · sha256 ${createHash("sha256").update(wasm).digest("hex")}`);
} finally {
  module.dispose();
}

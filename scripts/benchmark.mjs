import { mkdir, writeFile } from "node:fs/promises";
import { SandboxDemo } from "../lib/sandbox.mjs";
import { formatNear } from "../src/amount.js";

let demo;
try {
  console.log("Starting a local NEAR chain and installing the restricted agent key…");
  demo = await SandboxDemo.create();
  const report = await demo.runSuite((result) => {
    console.log(`${result.verified ? "PASS" : "FAIL"} ${result.label}: ${result.observed} · ${result.transaction.layer} · attacker received ${formatNear(result.attacker_delta)} NEAR`);
    if (!result.verified) console.error(JSON.stringify({ checks: result.checks, error: result.transaction.error }, null, 2));
  });
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  await writeFile(new URL("../artifacts/attack-report.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("Full receipts and balance checks: artifacts/attack-report.json");
  if (report.summary.cases_failed) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (demo) await demo.close();
}

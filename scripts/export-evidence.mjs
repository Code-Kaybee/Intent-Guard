import { readFile, writeFile } from "node:fs/promises";
import { validateProof } from "../src/evidence.js";

const report = validateProof(JSON.parse(await readFile(new URL("../artifacts/attack-report.json", import.meta.url), "utf8")));
await writeFile(new URL("../docs/sandbox-evidence.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(`Exported ${report.summary.cases_verified} verified Sandbox receipts to docs/sandbox-evidence.json.`);

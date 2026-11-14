import { mkdir, readFile, writeFile, copyFile, cp, rm } from "node:fs/promises";
import { validateProof } from "../src/evidence.js";

const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const report = validateProof(JSON.parse(await readFile(new URL("docs/sandbox-evidence.json", root), "utf8")));
const source = await readFile(new URL("index.html", root), "utf8");
if (!source.includes('data-runtime="live"')) throw new Error("The source page must declare its live runtime.");
await rm(output, { recursive: true, force: true });
await mkdir(new URL("src/", output), { recursive: true });
await mkdir(new URL("data/", output), { recursive: true });
await writeFile(new URL("index.html", output), source.replace('data-runtime="live"', 'data-runtime="recorded"'));
await copyFile(new URL("styles.css", root), new URL("styles.css", output));
await cp(new URL("assets/", root), new URL("assets/", output), { recursive: true });
for (const name of ["console", "amount", "attack-cases", "api", "evidence", "theme", "workspace"]) {
  await copyFile(new URL(`src/${name}.js`, root), new URL(`src/${name}.js`, output));
}
await writeFile(new URL("data/proof.json", output), JSON.stringify(report));
await writeFile(new URL(".nojekyll", output), "");
console.log(`Public demo built in dist/ · ${report.summary.cases_verified} verified, recorded NEAR cases.`);

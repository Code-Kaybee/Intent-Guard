import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRecordedRuntime, validateProof } from "../src/evidence.js";

const proof = JSON.parse(await readFile(new URL("../docs/sandbox-evidence.json", import.meta.url), "utf8"));

test("the public bundle contains complete, passing real Sandbox evidence", () => {
  assert.equal(validateProof(proof), proof);
  assert.equal(proof.summary.attacks_blocked, 19);
  assert.equal(proof.summary.cases_verified, 22);
});

test("failed checks and misleading summary totals cannot be published", () => {
  const failed = structuredClone(proof);
  failed.results[0].checks[0].passed = false;
  assert.throws(() => validateProof(failed), /did not verify/);
  const inflated = structuredClone(proof);
  inflated.summary.attacks_blocked += 1;
  assert.throws(() => validateProof(inflated), /does not match/);
  const missing = structuredClone(proof);
  missing.results.pop();
  assert.throws(() => validateProof(missing), /every case exactly once/);
});

test("private credentials are rejected even when nested in a valid report", () => {
  const leaked = structuredClone(proof);
  leaked.results[0].debug = { credentials: { private_key: "do-not-publish" } };
  assert.throws(() => validateProof(leaked), /Private credentials/);
});

test("replaying a case preserves the receipt and never counts it as a new payment", async () => {
  const runtime = createRecordedRuntime(proof);
  const original = proof.results.find((result) => result.id === "routine");
  const first = await runtime.run("routine");
  const repeated = await runtime.run("routine");
  assert.deepEqual(first.result, original);
  assert.deepEqual(repeated.result, original);
  assert.equal((await runtime.status()).results.length, 1);
  assert.equal((await runtime.report()).summary.benign_payments_succeeded, proof.summary.benign_payments_succeeded);
  first.result.transaction.transaction_hash = "changed-by-consumer";
  assert.equal((await runtime.run("routine")).result.transaction.transaction_hash, original.transaction.transaction_hash);
  await runtime.reset();
  assert.equal((await runtime.status()).results.length, 0);
  assert.deepEqual(await runtime.report(), proof);
});

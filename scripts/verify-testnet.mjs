import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { testnetProvider, view, deployedCodeHash } from "../lib/testnet.mjs";

const reportPath = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL("../docs/testnet-evidence.json", import.meta.url);
const report = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(report.network, "testnet");
const provider = testnetProvider();
const codeHash = await deployedCodeHash(provider, report.accounts.vault);
assert.equal(codeHash, report.wasm_sha256, "The public deployed code no longer matches the evidence.");
const invoice = await view(provider, report.accounts.vault, "get_invoice", { invoice_id: report.invoice.invoice_id });
assert.equal(invoice.receiver_id, report.invoice.receiver_id);
assert.equal(invoice.amount, report.invoice.amount);
assert.equal(invoice.status, "paid");
const accessKey = await provider.query({ request_type: "view_access_key", finality: "final", account_id: report.accounts.vault, public_key: report.agent_key.public_key });
assert.equal(accessKey.permission.FunctionCall.receiver_id, report.accounts.vault);
assert.deepEqual(accessKey.permission.FunctionCall.method_names, ["execute_payment"]);
assert.notEqual(accessKey.permission.FunctionCall.allowance, null);
const expectedRules = { "recipient-swap": "INVOICE_RECIPIENT_MISMATCH", replay: "INVOICE_NOT_ACTIVE" };
for (const result of report.results.filter((candidate) => candidate.transaction_hash)) {
  const transaction = await provider.txStatus(result.transaction_hash, report.accounts.vault, "FINAL");
  assert.equal(transaction.transaction.signer_id, report.accounts.vault);
  assert.equal(transaction.transaction.receiver_id, report.accounts.vault);
  assert.equal(transaction.transaction.public_key, report.agent_key.public_key);
  const action = transaction.transaction.actions[0].FunctionCall;
  assert.equal(action.method_name, "execute_payment");
  assert.equal(JSON.parse(Buffer.from(action.args, "base64").toString("utf8")).invoice_id, report.invoice.invoice_id);
  if (result.expected === "paid") assert.ok(transaction.status.SuccessValue !== undefined);
  else assert.ok(JSON.stringify(transaction.status.Failure).includes(expectedRules[result.id]));
}
console.log("Verified from public NEAR testnet: deployed code, owner invoice, scoped key and included transaction outcomes.");

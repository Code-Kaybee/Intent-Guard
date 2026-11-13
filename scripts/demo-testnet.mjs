import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { transactions } from "near-api-js";
import { testnetProvider, signingWallet, view, approveTestnetInvoice, TESTNET_DIRECTORY } from "../lib/testnet.mjs";
import { toYocto } from "../src/amount.js";

const plan = JSON.parse(await readFile(new URL("deployment-plan.json", TESTNET_DIRECTORY), "utf8"));
const provider = testnetProvider();
const agent = await signingWallet("agent", provider);
const status = await view(provider, plan.accounts.vault, "get_status");
const invoice = {
  invoice_id: `testnet-demo-${Date.now()}`,
  receiver_id: plan.accounts.vendor,
  amount: toYocto("0.08"),
  expires_at_ns: (BigInt(status.current_time_ns) + 3_600_000_000_000n).toString(),
};
const approvalHash = await approveTestnetInvoice(plan, invoice);
const balances = async () => {
  const [vendor, attacker] = await Promise.all([plan.accounts.vendor, plan.accounts.attacker].map((accountId) => provider.query({ request_type: "view_account", finality: "optimistic", account_id: accountId })));
  return { vendor: vendor.amount, attacker: attacker.amount };
};
const before = await balances();
const substituted = await agent.pay({ invoice_id: invoice.invoice_id, receiver_id: plan.accounts.attacker, amount: invoice.amount });
assert.equal(substituted.succeeded, false);
assert.ok(substituted.error.includes("INVOICE_RECIPIENT_MISMATCH"));
const direct = await agent.submit(plan.accounts.attacker, [transactions.transfer(BigInt(invoice.amount))]);
assert.equal(direct.accepted, false);
assert.ok(direct.error.includes("RequiresFullAccess"));
const afterAttacks = await balances();
assert.deepEqual(afterAttacks, before);
const payment = await agent.pay({ invoice_id: invoice.invoice_id, receiver_id: invoice.receiver_id, amount: invoice.amount });
assert.equal(payment.succeeded, true, payment.error);
const paidInvoice = await view(provider, plan.accounts.vault, "get_invoice", { invoice_id: invoice.invoice_id });
assert.equal(paidInvoice.status, "paid");
const afterPayment = await balances();
assert.equal((BigInt(afterPayment.vendor) - BigInt(before.vendor)).toString(), invoice.amount);
assert.equal(afterPayment.attacker, before.attacker);
const replay = await agent.pay({ invoice_id: invoice.invoice_id, receiver_id: invoice.receiver_id, amount: invoice.amount });
assert.equal(replay.succeeded, false);
assert.ok(replay.error.includes("INVOICE_NOT_ACTIVE"));
const finalBalances = await balances();
assert.deepEqual(finalBalances, afterPayment);
const accessKey = await provider.query({ request_type: "view_access_key", finality: "optimistic", account_id: plan.accounts.vault, public_key: plan.public_keys.agent });
const report = {
  network: "testnet", recorded_at: new Date().toISOString(), accounts: plan.accounts, wasm_sha256: plan.wasm_sha256,
  invoice, approval_hash: approvalHash, agent_key: { public_key: plan.public_keys.agent, permission: accessKey.permission },
  results: [
    { id: "recipient-swap", expected: "blocked", ...substituted },
    { id: "direct-transfer", expected: "blocked", ...direct },
    { id: "routine", expected: "paid", ...payment },
    { id: "replay", expected: "blocked", ...replay },
  ],
  balance_proof: { before, after_attacks: afterAttacks, after_payment: afterPayment, after_replay: finalBalances, vendor_received: invoice.amount, attacker_received: "0" },
  invoice_after: paidInvoice,
};
await writeFile(new URL("testnet-proof.json", TESTNET_DIRECTORY), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ verified: 4, vault: plan.accounts.vault, vendor_received: "0.08 NEAR", attacker_received: "0 NEAR", receipt_hashes: report.results.map((result) => ({ id: result.id, hash: result.transaction_hash })) }, null, 2));

import test from "node:test";
import assert from "node:assert/strict";
import { SandboxDemo } from "../lib/sandbox.mjs";
import { ATTACK_CASES } from "../src/attack-cases.js";
import { toYocto } from "../src/amount.js";

test("invoice authorizations and restricted keys enforce payments in the NEAR runtime", { timeout: 300_000 }, async (context) => {
  const demo = await SandboxDemo.create();
  context.after(() => demo.close());
  const initial = await demo.status();
  assert.deepEqual(initial.agent_key.permission.FunctionCall.method_names, ["execute_payment"]);
  assert.equal(initial.agent_key.permission.FunctionCall.receiver_id, demo.vault.accountId);
  assert.equal(initial.agent_key.permission.FunctionCall.allowance, toYocto("0.25"));

  for (const scenario of ATTACK_CASES) {
    await context.test(scenario.label, async () => {
      const result = await demo.run(scenario.id);
      assert.equal(result.observed, scenario.expected, result.transaction.error ?? scenario.label);
      assert.equal(result.transaction.layer, scenario.layer);
      for (const check of result.checks) assert.equal(check.passed, true, check.name);
      if (scenario.kind === "attack") {
        assert.equal(result.vendor_delta, "0");
        assert.equal(result.attacker_delta, "0");
        assert.equal(result.payment_budget_delta, "0");
        assert.equal(result.transaction.succeeded, false);
        assert.ok(result.transaction.error.toLowerCase().includes(scenario.rule.toLowerCase()));
        assert.equal(result.transaction.accepted, scenario.layer === "contract");
      } else if (scenario.kind === "benign") {
        assert.equal(result.vendor_delta, toYocto("0.08"));
        assert.equal(result.invoice_after.status, "paid");
        assert.ok(result.transaction.transaction_hash);
        assert.ok(result.transaction.logs.some((log) => log.includes("payment_settled")));
      }
    });
  }

  await context.test("a failed transfer releases budget but never reopens its invoice", async () => {
    const failed = demo.results.find((result) => result.id === "failed-settlement");
    assert.equal(failed.invoice_after.status, "failed");
    assert.equal(failed.payment_budget_delta, "0");
    assert.equal(failed.after.vault.payments_failed, failed.before.vault.payments_failed + 1);
    assert.ok(failed.transaction.receipt_failures.length > 0);
    const retry = await demo.agent.pay({
      invoice_id: failed.invoice_id,
      receiver_id: failed.authorized_invoice.receiver_id,
      amount: failed.authorized_invoice.amount,
    });
    assert.equal(retry.succeeded, false);
    assert.ok(retry.error.includes("INVOICE_NOT_ACTIVE"));
  });

  await context.test("owners cannot replace an existing invoice with a different recipient", async () => {
    const paid = demo.results.find((result) => result.id === "routine");
    const status = await demo.vault.view("get_status", {});
    const replacement = await demo.owner.callRaw(demo.vault, "approve_invoice", {
      invoice_id: paid.invoice_id,
      receiver_id: demo.attacker.accountId,
      amount: toYocto("0.08"),
      expires_at_ns: (BigInt(status.current_time_ns) + 3_600_000_000_000n).toString(),
    });
    assert.equal(replacement.succeeded, false);
    assert.ok(replacement.receiptFailureMessages.join(" ").includes("INVOICE_ID_EXISTS"));
    const invoice = await demo.vault.view("get_invoice", { invoice_id: paid.invoice_id });
    assert.equal(invoice.receiver_id, demo.vendor.accountId);
    assert.equal(invoice.status, "paid");
  });

  await context.test("one yoctoNEAR of amount tampering is rejected", async () => {
    const status = await demo.vault.view("get_status", {});
    await demo.owner.call(demo.vault, "approve_invoice", {
      invoice_id: "exact-precision",
      receiver_id: demo.vendor.accountId,
      amount: toYocto("0.08"),
      expires_at_ns: (BigInt(status.current_time_ns) + 3_600_000_000_000n).toString(),
    });
    const result = await demo.agent.pay({
      invoice_id: "exact-precision",
      receiver_id: demo.vendor.accountId,
      amount: (BigInt(toYocto("0.08")) + 1n).toString(),
    });
    assert.equal(result.succeeded, false);
    assert.ok(result.error.includes("INVOICE_AMOUNT_MISMATCH"));
  });
});

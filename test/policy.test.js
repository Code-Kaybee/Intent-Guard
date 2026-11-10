import test from "node:test";
import assert from "node:assert/strict";
import {
  createExactApproval,
  consumeExactApproval,
  evaluateIntent,
  isExactApprovalValid,
} from "../src/policy.js";
import { SCENARIOS } from "../src/scenarios.js";

function scenario(id) {
  return SCENARIOS.find((item) => item.id === id).intent;
}

test("known invoice payment is allowed", () => {
  assert.equal(evaluateIntent(scenario("routine")).decision, "allow");
});

test("recipient substitution and changed contract are blocked", () => {
  assert.equal(evaluateIntent(scenario("injection")).decision, "block");
  assert.equal(evaluateIntent(scenario("contract")).decision, "block");
});

test("invoice amount mismatch and new counterparty require review", () => {
  assert.equal(evaluateIntent(scenario("amount")).decision, "warn");
  assert.equal(evaluateIntent(scenario("new-recipient")).decision, "warn");
});

test("exact approval does not carry over to a changed recipient or amount", () => {
  const original = scenario("new-recipient");
  const approval = createExactApproval(original, { now: 1_000, ttlMs: 60_000 });
  assert.equal(isExactApprovalValid(approval, original, { now: 2_000 }), true);
  assert.equal(isExactApprovalValid(approval, { ...original, receiver: "other.testnet" }, { now: 2_000 }), false);
  assert.equal(isExactApprovalValid(approval, { ...original, amount: 0.09 }, { now: 2_000 }), false);
});

test("exact approval can only be consumed once", () => {
  const original = scenario("new-recipient");
  const approval = createExactApproval(original, { now: 1_000, ttlMs: 60_000 });
  assert.equal(consumeExactApproval(approval, original, { now: 2_000 }), true);
  assert.equal(isExactApprovalValid(approval, original, { now: 2_000 }), false);
  assert.equal(consumeExactApproval(approval, original, { now: 2_000 }), false);
});

test("exact approval expires and cannot authorize mainnet", () => {
  const original = scenario("new-recipient");
  const approval = createExactApproval(original, { now: 1_000, ttlMs: 100 });
  assert.equal(isExactApprovalValid(approval, original, { now: 1_100 }), false);
  assert.equal(evaluateIntent({ ...original, network: "mainnet" }).decision, "block");
});

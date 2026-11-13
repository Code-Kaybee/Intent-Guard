import test from "node:test";
import assert from "node:assert/strict";
import { formatNear, toYocto } from "../src/amount.js";

test("invoice amounts retain all 24 decimal places", () => {
  assert.equal(toYocto("0.08"), "80000000000000000000000");
  assert.equal(toYocto("0.000000000000000000000001"), "1");
  assert.equal(toYocto("1.000000000000000000000001"), "1000000000000000000000001");
  assert.equal(formatNear("1000000000000000000000001"), "1.000000000000000000000001");
  assert.equal(formatNear("0"), "0");
});

test("ambiguous, rounded and invalid financial input is rejected", () => {
  for (const amount of [0.08, "8e-2", " 0.08", "0.08 ", "+0.08", "-1", "01", "0", "NaN", "Infinity", "1.", ".1", "0.0000000000000000000000001"]) {
    assert.throws(() => toYocto(amount));
  }
});

test("amounts enforce the contract's integer bounds", () => {
  const maximum = (1n << 128n) - 1n;
  assert.equal(toYocto(formatNear(maximum.toString())), maximum.toString());
  assert.throws(() => toYocto(formatNear((maximum + 1n).toString())));
});

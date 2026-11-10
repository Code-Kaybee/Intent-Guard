export const DEFAULT_POLICY = Object.freeze({
  dailyLimit: 5,
  perPaymentLimit: 2,
  knownBadRecipients: ["spoofed-vendor.testnet"],
  supportedNetwork: "testnet",
});

export function evaluateIntent(intent, policy = DEFAULT_POLICY) {
  const amount = Number(intent.amount);
  const reasons = [];
  const rules = [];

  if (!Number.isFinite(amount) || amount <= 0) {
    return result("block", ["Payment amount must be greater than zero."], ["valid_amount"]);
  }

  if (intent.network !== policy.supportedNetwork) {
    return result("block", [`Only ${policy.supportedNetwork} actions are enabled in this prototype.`], ["network_scope"]);
  }

  if (intent.action !== "transfer") {
    return result("block", ["This prototype only permits native NEAR transfers."], ["action_scope"]);
  }

  if (intent.expectedReceiver && intent.receiver !== intent.expectedReceiver) {
    reasons.push(`Recipient differs from the invoice: expected ${intent.expectedReceiver}.`);
    rules.push("invoice_recipient_match");
  }

  if (policy.knownBadRecipients.includes(intent.receiver)) {
    reasons.push("Recipient is in the demo blocklist.");
    rules.push("known_bad_recipient");
  }

  if (intent.codeChanged) {
    reasons.push("Recipient contract code changed since it was last reviewed.");
    rules.push("contract_code_change");
  }

  if (amount > policy.perPaymentLimit) {
    reasons.push(`Payment exceeds the ${policy.perPaymentLimit} NEAR per-payment limit.`);
    rules.push("per_payment_limit");
  }

  if ((Number(intent.spentToday) || 0) + amount > policy.dailyLimit) {
    reasons.push(`Payment would exceed the ${policy.dailyLimit} NEAR daily limit.`);
    rules.push("daily_limit");
  }

  if (reasons.length && rules.some((rule) => [
    "invoice_recipient_match",
    "known_bad_recipient",
    "contract_code_change",
    "per_payment_limit",
    "daily_limit",
  ].includes(rule))) {
    return result("block", reasons, rules);
  }

  if (intent.expectedAmount != null && Math.abs(amount - Number(intent.expectedAmount)) > 0.000001) {
    reasons.push(`Amount differs from the invoice: expected ${Number(intent.expectedAmount)} NEAR.`);
    rules.push("invoice_amount_match");
  }

  if (Number(intent.accountAgeDays) < 7 && Number(intent.priorPayments) === 0) {
    reasons.push("New recipient with no previous payment history.");
    rules.push("new_counterparty");
  }

  if (reasons.length) return result("warn", reasons, rules);

  return result("allow", ["Matches the invoice and current spending policy."], ["policy_match"]);
}

export function canonicalIntent(intent) {
  return JSON.stringify({
    network: intent.network,
    signer: intent.signer,
    receiver: intent.receiver,
    action: intent.action,
    asset: intent.asset,
    amount: Number(intent.amount).toString(),
    expectedReceiver: intent.expectedReceiver ?? null,
    expectedAmount: intent.expectedAmount == null ? null : Number(intent.expectedAmount).toString(),
    methodName: intent.methodName ?? null,
    args: stableStringify(intent.args ?? {}),
    codeHash: intent.codeHash ?? null,
  });
}

export function createExactApproval(intent, { now = Date.now(), ttlMs = 60_000 } = {}) {
  return {
    canonicalIntent: canonicalIntent(intent),
    expiresAt: now + ttlMs,
  };
}

export function isExactApprovalValid(approval, intent, { now = Date.now() } = {}) {
  return Boolean(
    approval &&
    now < approval.expiresAt &&
    approval.canonicalIntent === canonicalIntent(intent)
  );
}

function result(decision, reasons, rules) {
  return { decision, reasons, rules };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

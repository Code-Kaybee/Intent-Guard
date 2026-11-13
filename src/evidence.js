import { ATTACK_CASES } from "./attack-cases.js";

export function validateProof(report) {
  if (report.schema_version !== 1 || report.network !== "sandbox" || !Array.isArray(report.results)) {
    throw new Error("The evidence bundle is not a supported NEAR Sandbox report.");
  }
  const identifiers = new Set(report.results.map((result) => result.id));
  if (identifiers.size !== ATTACK_CASES.length || report.results.length !== ATTACK_CASES.length) {
    throw new Error("The evidence bundle must include every case exactly once.");
  }
  for (const scenario of ATTACK_CASES) {
    const result = report.results.find((entry) => entry.id === scenario.id);
    if (!result || result.kind !== scenario.kind || result.expected !== scenario.expected
        || result.observed !== scenario.expected || result.transaction?.layer !== scenario.layer
        || !result.verified || !result.checks?.length || result.checks.some((check) => check.passed !== true)) {
      throw new Error(`The captured evidence did not verify: ${scenario.label}.`);
    }
    if (scenario.kind === "attack" && (result.attacker_delta !== "0" || result.vendor_delta !== "0" || result.payment_budget_delta !== "0")) {
      throw new Error(`The attack moved funds or consumed payment budget: ${scenario.label}.`);
    }
    if (!result.before?.vault || !result.after?.vault || !result.proposed_tool_call || !result.signing_key
        || !Number.isFinite(Date.parse(result.recorded_at))) {
      throw new Error(`The receipt is incomplete: ${scenario.label}.`);
    }
  }
  const attacks = report.results.filter((result) => result.kind === "attack");
  const benign = report.results.filter((result) => result.kind === "benign");
  const loss = report.results.filter((result) => result.kind === "control")
    .reduce((total, result) => total + BigInt(result.attacker_delta), 0n).toString();
  const summary = report.summary;
  if (!summary || summary.cases_total !== report.results.length || summary.cases_verified !== report.results.length
      || summary.cases_failed !== 0 || summary.attacks_total !== attacks.length || summary.attacks_blocked !== attacks.length
      || summary.benign_payments_total !== benign.length || summary.benign_payments_succeeded !== benign.length
      || summary.baseline_attacker_received !== loss) {
    throw new Error("The evidence summary does not match the captured receipts.");
  }
  if (!/^[a-f0-9]{64}$/.test(report.contract?.wasm_sha256 ?? "") || !report.agent_key?.permission?.FunctionCall) {
    throw new Error("The report is missing the deployed code digest or scoped agent key.");
  }
  function rejectCredentials(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (["private_key", "secret_key", "seed_phrase", "mnemonic"].includes(key.toLowerCase())) {
        throw new Error("Private credentials cannot be included in public evidence.");
      }
      rejectCredentials(nested);
    }
  }
  rejectCredentials(report);
  return report;
}

// Replaying a receipt preserves its original transaction, balances, and UTC time.
export function createRecordedRuntime(evidence) {
  const report = structuredClone(validateProof(evidence));
  const explored = new Map();
  let current = null;
  const invoice = report.results.find((result) => result.kind === "benign");
  const control = report.results.find((result) => result.kind === "control");
  function status() {
    const vault = current?.after.vault ?? report.results[0].before.vault;
    return structuredClone({
      ready: true, recorded: true, network: "sandbox", chain_label: "Recorded NEAR Sandbox",
      captured_at: report.generated_at, vault, agent_key: report.agent_key,
      accounts: {
        owner: vault.owner_id, vault: report.contract.account_id,
        vendor: invoice.authorized_invoice.receiver_id,
        attacker: control.proposed_tool_call.payment_receiver,
        unprotected: control.proposed_tool_call.signer_id,
      },
      results: [...explored.values()], proof_summary: report.summary,
    });
  }
  return {
    recorded: true,
    status: async () => status(),
    scenarios: async () => ({
      scenarios: ATTACK_CASES.map((scenario) => {
        const result = report.results.find((entry) => entry.id === scenario.id);
        return {
          ...scenario, signer: result.proposed_tool_call.signer_id,
          payment_receiver: result.proposed_tool_call.payment_receiver,
          transaction_target: result.proposed_tool_call.transaction_target,
          amount: result.proposed_tool_call.amount, method: result.proposed_tool_call.method,
          signing_key: structuredClone(result.signing_key), owner_invoice: structuredClone(result.authorized_invoice),
        };
      }),
    }),
    run: async (id) => {
      const result = report.results.find((entry) => entry.id === id);
      if (!result) throw new Error("Choose an available scenario.");
      current = result;
      explored.delete(id);
      explored.set(id, result);
      return { result: structuredClone(result), status: status() };
    },
    reset: async () => { explored.clear(); current = null; return status(); },
    report: async () => structuredClone(report),
  };
}

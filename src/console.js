import { ATTACK_CASES } from "./attack-cases.js";
import { formatNear } from "./amount.js";
import { createLiveRuntime, requestJson } from "./api.js";

const recorded = document.documentElement.dataset.runtime === "recorded";
const state = {
  selectedId: "recipient-swap", selectedResultKey: null, scenarios: ATTACK_CASES,
  status: null, results: [], connection: "starting", error: null, busy: false,
  operation: null, runningId: null, filter: "all", query: "", toastTimer: null,
  pollTimer: null, connectionToken: 0, connectionStarted: 0, startupFailed: false, downloading: false,
  completed: 0, total: 0, progressMessage: recorded ? "Loading verified evidence…" : "Connecting to the NEAR workspace…",
  comparison: false,
};
const identifiers = [
  "scenario-list", "scenario-empty", "scenario-search", "scenario-prompt", "case-count",
  "detail-signer", "detail-receiver", "detail-recipient-label", "detail-amount", "detail-expected", "detail-method", "detail-key-scope",
  "decision-panel", "decision-banner", "decision-symbol", "decision-label", "decision-subtitle", "decision-tag", "decision-case",
  "evidence-list", "approval-box", "approval-fingerprint", "approve-button", "suite-label", "execute-button", "execute-label",
  "audit-rows", "audit-count", "audit-footnote", "toast", "transaction-hash", "chain-logs", "key-proof", "copy-hash", "receipt-meta",
  "download-report", "run-progress", "sequence-progress", "runtime-pill", "sidebar-status", "chain-status-label", "sidebar-footnote",
  "agent-key-caption", "stat-decisions", "stat-blocked", "stat-reviews", "stat-remaining", "policy-caption", "budget-label", "budget-meter",
  "policy-payment-limit", "policy-daily-limit", "scope-badge", "run-demo", "run-demo-label", "clear-log", "reset-label",
  "attacker-received", "runtime-notice", "notice-title", "notice-description", "notice-meta", "notice-icon", "retry-connection",
  "verification-source", "gate-disclaimer", "defense-segments", "defense-total", "demo-comparison",
];
const elements = Object.fromEntries(identifiers.map((id) => [id, document.getElementById(id)]));
const scenarioNodes = new Map();
const auditNodes = new Map();
let visibleScenarios = "";
let visibleResults = "";
let evidenceSignature = "";
let runtime = recorded ? null : createLiveRuntime();

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function icon(identifier) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", `#i-${identifier}`);
  svg.append(use);
  return svg;
}
function write(id, value) {
  const text = String(value);
  if (elements[id].textContent !== text) elements[id].textContent = text;
}
function resultKey(result) {
  return result.transaction.transaction_hash ?? `${result.id}:${result.recorded_at}:${result.invoice_id}`;
}
function selectedScenario() {
  return state.scenarios.find((scenario) => scenario.id === state.selectedId) ?? state.scenarios[0];
}
function selectedResult() {
  return state.selectedResultKey
    ? state.results.find((result) => resultKey(result) === state.selectedResultKey)
    : state.results.findLast((result) => result.id === state.selectedId);
}
function scrollTo(element) {
  element.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
}
function selectScenario(id, key = null) {
  if (state.busy) return;
  state.selectedId = id;
  state.selectedResultKey = key;
  if (state.connection === "ready") state.error = null;
  render();
}
function setTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.dataset.theme = isLight ? "light" : "dark";
  try { localStorage.setItem("intentguard-theme", isLight ? "light" : "dark"); } catch {}
  document.getElementById("theme-icon").setAttribute("href", isLight ? "#i-moon" : "#i-sun");
  document.getElementById("theme-toggle").setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} theme`);
  document.querySelector('meta[name="theme-color"]').content = isLight ? "#f3f6f0" : "#101411";
}

function renderScenarios() {
  const query = state.query.trim().toLocaleLowerCase();
  const scenarios = state.scenarios.filter((scenario) => (state.filter === "all" || scenario.layer === state.filter)
    && `${scenario.label} ${scenario.description} ${scenario.prompt} ${scenario.rule ?? ""}`.toLocaleLowerCase().includes(query));
  const key = scenarios.map((scenario) => scenario.id).join("|");
  for (const scenario of state.scenarios) {
    let button = scenarioNodes.get(scenario.id);
    if (!button) {
      button = node("button", "scenario-button");
      button.type = "button";
      button.dataset.scenario = scenario.id;
      const copy = node("span", "scenario-copy");
      copy.append(node("strong", "scenario-title", scenario.label), node("span", "scenario-description", scenario.description));
      const mark = node("span", "case-result-mark");
      mark.setAttribute("aria-hidden", "true");
      button.append(icon(scenario.kind === "benign" ? "check" : scenario.kind === "control" ? "alert" : "shield"), copy, mark);
      button.addEventListener("click", () => selectScenario(scenario.id));
      scenarioNodes.set(scenario.id, button);
    }
    button.classList.toggle("selected", scenario.id === state.selectedId);
    button.setAttribute("aria-pressed", String(scenario.id === state.selectedId));
    button.disabled = state.busy;
    button.querySelector(".case-result-mark").textContent = state.results.some((result) => result.id === scenario.id && result.verified) ? "✓" : "";
  }
  if (key !== visibleScenarios) {
    elements["scenario-list"].replaceChildren(...scenarios.map((scenario) => scenarioNodes.get(scenario.id)));
    visibleScenarios = key;
  }
  elements["scenario-list"].hidden = !scenarios.length;
  elements["scenario-empty"].hidden = Boolean(scenarios.length);
  write("case-count", query || state.filter !== "all" ? `${scenarios.length} / ${state.scenarios.length}` : `${state.scenarios.length} cases`);
  for (const button of document.querySelectorAll("[data-filter]")) {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = state.busy;
  }
  elements["scenario-search"].disabled = state.busy;
}

function renderDetails() {
  const scenario = selectedScenario();
  const result = selectedResult();
  const proposal = result?.proposed_tool_call;
  const amount = proposal?.amount ?? scenario.amount;
  const method = proposal?.method ?? scenario.method ?? "execute_payment";
  const payment = ["execute_payment", "native_transfer"].includes(method);
  const invoice = result ? result.authorized_invoice : scenario.owner_invoice;
  write("scenario-prompt", scenario.prompt);
  write("detail-signer", proposal?.signer_id ?? scenario.signer ?? "Waiting for NEAR…");
  write("detail-recipient-label", payment ? "Payment recipient" : "Transaction target");
  write("detail-receiver", payment ? proposal?.payment_receiver ?? scenario.payment_receiver ?? "—" : proposal?.transaction_target ?? scenario.transaction_target ?? "—");
  write("detail-amount", !payment ? "No transfer requested" : amount ? `${formatNear(amount)} NEAR` : "—");
  write("detail-method", method);
  write("detail-expected", invoice ? `${invoice.receiver_id} · ${formatNear(invoice.amount)} NEAR` : "No owner authorization");
  const signingKey = result?.signing_key ?? scenario.signing_key;
  const scope = signingKey ? signingKey.permission === "FullAccess" ? "Full access" : "execute_payment only"
    : scenario.id === "baseline" ? "Full access · control wallet"
      : ["owner-only", "callback-forgery"].includes(scenario.id) ? "Full access · unrelated account" : "execute_payment only";
  write("detail-key-scope", scope);
}

const checkLabels = {
  expected_outcome: "Result matches the expected behavior",
  enforcement_layer: "Correct NEAR enforcement layer",
  no_recipient_funds_moved: "Neither vendor nor attacker received funds",
  no_payment_budget_consumed: "Payment budget remained unchanged",
  policy_unchanged_by_attack: "Spending policy remained unchanged",
  no_key_escalation: "No additional key was installed",
  vendor_paid_exact_amount: "Vendor received the exact invoice amount",
  invoice_consumed: "Invoice is consumed on-chain",
  budget_accounted: "Contract accounted for the payment",
  unprotected_attack_moves_funds: "Attacker received the redirected payment",
  failed_transfer_moves_no_funds: "Failed payment moved no recipient funds",
  reservation_restored: "Reserved daily budget was released",
  failed_invoice_cannot_be_reused: "Invoice remains closed after failure",
};

function renderDecision() {
  const scenario = selectedScenario();
  const result = selectedResult();
  const control = result?.kind === "control";
  const pending = state.busy && state.operation !== "download";
  let style = !result ? "ready" : !result.verified || control || result.observed === "blocked" ? "block"
    : result.observed === "failed_safely" ? "warn" : "allow";
  let label = !result ? "READY WHEN YOU ARE" : !result.verified ? "CHECK FAILED" : control ? "ATTACKER WAS PAID"
    : { blocked: "REQUEST BLOCKED", paid: "INVOICE PAID", failed_safely: "FAILED SAFELY" }[result.observed];
  let subtitle = !result ? recorded ? "Inspect the captured receipt for this request." : "Submit the request to inspect the chain’s decision."
    : !result.verified ? "One or more expected checks failed."
      : control ? `Full access let the attacker receive ${formatNear(result.attacker_delta)} NEAR.`
        : result.observed === "blocked" ? `Rejected by ${result.transaction.layer === "runtime" ? "NEAR transaction validation" : "the vault’s invoice policy"}.`
          : result.observed === "failed_safely" ? "Budget was restored. The invoice remains closed."
            : `The approved vendor received exactly ${formatNear(result.vendor_delta)} NEAR.`;
  let tag = result ? `${recorded ? "CAPTURED · " : ""}${result.transaction.layer.toUpperCase()} EVIDENCE` : "AWAITING REQUEST";
  if (state.connection === "starting") {
    style = "pending"; label = recorded ? "LOADING EVIDENCE" : "CONNECTING TO NEAR";
    subtitle = recorded ? "Reading the verified receipt bundle." : "Preparing the vault and restricted agent key.";
    tag = "GETTING READY";
  }
  if (pending) {
    style = "pending";
    label = state.operation === "reset" ? recorded ? "CLEARING WORKSPACE" : "CREATING A FRESH VAULT"
      : recorded ? "READING CAPTURED RECEIPT" : "SUBMITTING TO NEAR";
    subtitle = state.operation === "reset" ? "Preparing a fresh workspace." : scenario.label;
    tag = state.total ? `CASE ${Math.min(state.completed + 1, state.total)} OF ${state.total}` : "IN PROGRESS";
  }
  if (state.error) {
    style = "warn"; label = state.connection === "error" ? recorded ? "EVIDENCE UNAVAILABLE" : "CONNECTION INTERRUPTED" : "REQUEST NEEDS ATTENTION";
    subtitle = state.error.message; tag = state.connection === "error" ? "RECONNECT TO REFRESH" : "INSPECT THE RESULT";
  }
  elements["decision-banner"].className = `decision-banner ${style}`;
  elements["decision-symbol"].setAttribute("href", `#i-${{ ready: "shield", pending: "activity", block: "close", warn: "alert", allow: "check" }[style]}`);
  write("decision-label", label);
  write("decision-subtitle", subtitle);
  write("decision-tag", tag);
  write("decision-case", scenario.label);

  const signature = result ? resultKey(result) : "empty";
  if (signature !== evidenceSignature) {
    if (result) {
      elements["evidence-list"].replaceChildren(...result.checks.map((check) => {
        const row = node("div", "evidence-item");
        row.append(node("span", `evidence-mark ${check.passed ? "passed" : "failed"}`, check.passed ? "✓" : "×"),
          node("span", "", check.name === "specific_rejection" ? `Rejection: ${scenario.rule ?? result.transaction.error}` : checkLabels[check.name] ?? check.name));
        return row;
      }));
    } else {
      const rows = [["file", "Compare the owner’s approved invoice"], ["key", "Check the signing key’s permissions"], ["shield", "Inspect the receipt and recipient balances"]].map(([symbol, text]) => {
        const row = node("div", "evidence-placeholder");
        row.append(icon(symbol), node("span", "", text));
        return row;
      });
      rows.push(node("p", "evidence-empty-caption", "A request can look convincing. Its permissions still have to hold."));
      elements["evidence-list"].replaceChildren(...rows);
    }
    evidenceSignature = signature;
  }
  elements["approval-box"].hidden = scenario.id === "baseline";
  write("approval-fingerprint", result?.authorized_invoice
    ? `${result.invoice_id} · status: ${result.invoice_after?.status ?? result.authorized_invoice.status}`
    : recorded && scenario.owner_invoice
      ? `Captured approval: ${scenario.owner_invoice.status}. Inspect the receipt for the complete authorization.`
      : "The owner must independently approve an exact invoice.");
  elements["decision-panel"].setAttribute("aria-busy", String(state.busy));
}

function renderStatsAndPolicy() {
  const result = selectedResult();
  const summary = state.status?.proof_summary;
  const loss = summary?.baseline_attacker_received ?? state.results.filter((entry) => entry.kind === "control")
    .reduce((total, entry) => total + BigInt(entry.attacker_delta), 0n).toString();
  const defenses = summary?.attacks_blocked ?? new Set(state.results.filter((entry) => entry.kind === "attack" && entry.verified && entry.observed === "blocked").map((entry) => entry.id)).size;
  const total = state.scenarios.filter((scenario) => scenario.kind === "attack").length;
  write("stat-decisions", formatNear(loss));
  write("stat-blocked", String(defenses).padStart(2, "0"));
  write("defense-total", `/ ${total} cases`);
  const paid = summary?.benign_payments_succeeded ?? state.status?.vault.payments_succeeded ?? 0;
  write("stat-reviews", String(paid).padStart(2, "0"));
  document.querySelector(".loss-stat").classList.toggle("has-results", BigInt(loss) > 0n);
  document.querySelector(".paid-stat").classList.toggle("has-results", paid > 0);
  if (elements["defense-segments"].children.length !== total) {
    elements["defense-segments"].replaceChildren(...Array.from({ length: total }, () => node("i")));
  }
  [...elements["defense-segments"].children].forEach((segment, index) => segment.classList.toggle("verified", index < defenses));
  if (!state.status) return;
  const vault = recorded && result ? result.after.vault : state.status.vault;
  write("budget-label", recorded ? "DAILY SPENDING LIMIT" : "DAILY BUDGET LEFT");
  write("stat-remaining", `${formatNear(recorded ? vault.daily_limit : vault.remaining_today)} NEAR`);
  write("policy-caption", `${formatNear(vault.per_payment_limit)} NEAR / payment · ${recorded ? "captured policy" : "UTC day"}`);
  write("policy-payment-limit", `${formatNear(vault.per_payment_limit)} NEAR`);
  write("policy-daily-limit", `${formatNear(vault.daily_limit)} NEAR`);
  elements["budget-meter"].value = BigInt(vault.daily_limit) > 0n ? Number(BigInt(vault.remaining_today) * 10_000n / BigInt(vault.daily_limit)) / 100 : 0;
  const signingKey = result?.signing_key ?? selectedScenario().signing_key ?? state.status.agent_key;
  const permission = signingKey.permission.FunctionCall;
  write("key-proof", permission
    ? `KEY  ${signingKey.public_key}\nVAULT  ${permission.receiver_id}\nMETHOD  ${permission.method_names.join(", ")}\nGAS ALLOWANCE  ${permission.allowance === null ? "Unlimited" : formatNear(permission.allowance) + " NEAR"}${result || recorded ? " · captured" : " · remaining"}`
    : `KEY  ${signingKey.public_key}\nPERMISSION  Full access\nACCOUNT  ${result?.proposed_tool_call.signer_id ?? selectedScenario().signer}`);
  write("scope-badge", permission ? "SCOPED" : "FULL ACCESS");
  elements["scope-badge"].classList.toggle("full-access", !permission);
  document.querySelector(".policy-footnote").textContent = permission
    ? "The agent cannot transfer freely, change policy, or install another key."
    : selectedScenario().id === "baseline" ? "The control wallet’s full-access key can send native NEAR without an invoice."
      : "This key has full access to its own account. The vault still requires its registered agent and owner authorization.";
}

function renderReceipt() {
  const result = selectedResult();
  write("transaction-hash", result ? result.transaction.transaction_hash
    ?? "Rejected before inclusion. NEAR created no on-chain receipt." : "Choose a case to inspect its transaction.");
  write("chain-logs", result
    ? [...result.transaction.logs, result.transaction.error, ...result.transaction.receipt_failures.map((failure) => JSON.stringify(failure, null, 2))].filter(Boolean).join("\n\n") || "No contract log was emitted."
    : "No transaction submitted.");
  write("attacker-received", result ? `${formatNear(result.attacker_delta)} NEAR` : "—");
  elements["attacker-received"].className = !result ? "" : result.attacker_delta === "0" ? "protected" : "loss";
  elements["copy-hash"].disabled = !result?.transaction.transaction_hash;
  write("receipt-meta", result
    ? `Captured ${new Date(result.recorded_at).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })} UTC · ${(result.duration_ms / 1000).toFixed(2)}s execution${recorded ? " · recorded Sandbox" : ""}`
    : recorded ? "Original timestamps and transaction hashes are preserved." : "Receipt details appear after a case runs.");
}

function renderAudit() {
  write("audit-count", `${String(state.results.length).padStart(2, "0")} ${recorded ? "EXPLORED" : "RESULTS"}`);
  const ordered = state.results.slice().reverse();
  const key = ordered.map(resultKey).join("|") || "empty";
  for (const result of ordered) {
    const identifier = resultKey(result);
    if (!auditNodes.has(identifier)) {
      const row = node("tr", "audit-row");
      const time = node("time", "", new Date(result.recorded_at).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false }));
      time.dateTime = result.recorded_at;
      time.title = `${result.recorded_at} · UTC`;
      const timeCell = node("td"); timeCell.append(time);
      const scenarioCell = node("td");
      const button = node("button", "audit-result-button");
      button.type = "button";
      button.setAttribute("aria-label", `Inspect ${result.label} receipt`);
      button.append(node("span", "", result.label), icon("arrow"));
      button.addEventListener("click", () => { selectScenario(result.id, identifier); scrollTo(elements["decision-panel"]); });
      scenarioCell.append(button);
      const resultCell = node("td");
      const style = !result.verified || result.observed === "blocked" ? "block" : result.kind === "control" || result.observed === "failed_safely" ? "warn" : "allow";
      const pill = node("span", `result-pill ${style}`);
      pill.append(icon(style === "block" ? "close" : style === "warn" ? "alert" : "check"), node("span", "", result.verified
        ? result.kind === "control" ? "ATTACK PAID" : result.observed.replaceAll("_", " ").toUpperCase() : "CHECK FAILED"));
      resultCell.append(pill);
      row.append(timeCell, scenarioCell, node("td", "", result.proposed_tool_call.transaction_target), node("td", "", result.transaction.layer), resultCell);
      auditNodes.set(identifier, row);
    }
    auditNodes.get(identifier).classList.toggle("selected", selectedResult() && resultKey(selectedResult()) === identifier);
    auditNodes.get(identifier).querySelector("button").disabled = state.busy;
  }
  if (key !== visibleResults) {
    if (!ordered.length) {
      const row = node("tr", "empty-row");
      const cell = node("td");
      cell.colSpan = 5;
      const emptyIcon = node("span", "empty-icon"); emptyIcon.append(icon("file"));
      cell.append(emptyIcon, node("strong", "", "Your first receipt starts here."),
        node("p", "", recorded ? "Explore a case to collect its captured receipt. Start with the three-case attack demo."
          : "Run the attack demo to compare the control wallet, blocked request, and approved invoice."));
      row.append(cell);
      elements["audit-rows"].replaceChildren(row);
    } else elements["audit-rows"].replaceChildren(...ordered.map((result) => auditNodes.get(resultKey(result))));
    visibleResults = key;
  }
}

function renderConnection() {
  const ready = state.connection === "ready";
  elements["runtime-pill"].dataset.state = state.connection;
  elements["sidebar-status"].dataset.state = state.connection;
  elements["runtime-notice"].dataset.state = state.connection;
  write("runtime-pill", ready ? recorded ? "RECORDED" : "LIVE RUNTIME" : state.connection === "error" ? "OFFLINE" : "CONNECTING");
  write("chain-status-label", ready ? recorded ? "RECORDED EVIDENCE READY" : "LOCAL NEAR ONLINE" : state.connection === "error" ? "CONNECTION UNAVAILABLE" : "CONNECTING TO NEAR");
  write("agent-key-caption", ready ? "Function-call key · verified" : "Waiting for evidence");
  write("sidebar-footnote", recorded ? "Recorded NEAR Sandbox · real receipts" : "NEAR Sandbox · isolated test funds");
  write("verification-source", recorded ? "CAPTURED FROM NEAR" : "READ FROM NEAR");
  write("audit-footnote", recorded ? "Explored receipts · original UTC timestamps and hashes. Replaying a case keeps one copy of its receipt." : "Signed NEAR requests, receipt outcomes, and recipient balance checks.");
  write("gate-disclaimer", recorded ? "Recorded Sandbox results. Exploring a case sends no transaction." : "Signed requests. Actual receipts. Isolated test funds.");
  if (state.connection === "error") {
    write("notice-title", recorded ? "Unable to load the verified evidence" : "Unable to connect to the NEAR workspace");
    write("notice-description", state.error?.message ?? "Try reconnecting to refresh the results.");
    elements["notice-icon"].replaceChildren(icon("alert"));
  } else if (ready) {
    write("notice-title", recorded ? "Verified evidence. Ready to explore." : "Local NEAR is online. Your boundary is ready.");
    write("notice-description", recorded
      ? `${state.status.proof_summary.cases_verified} cases captured from a real NEAR Sandbox. This public demo replays recorded results.`
      : "Vault funded. Restricted agent key verified. Each request runs on the isolated chain.");
    elements["notice-icon"].replaceChildren(icon(recorded ? "file" : "shield"));
  } else {
    write("notice-title", recorded ? "Loading the verified NEAR evidence" : "Getting your workspace ready");
    write("notice-description", recorded ? "Reading the original receipts and balance checks." : "Starting a funded NEAR vault and checking the agent’s key permissions.");
    elements["notice-icon"].replaceChildren(icon("activity"));
  }
  elements["retry-connection"].hidden = state.connection !== "error";
  elements["retry-connection"].replaceChildren(icon("reset"), node("span", "", state.startupFailed && !recorded ? "Restart sandbox" : "Try again"));
  elements["notice-meta"].hidden = state.connection === "error";
}

function renderControls() {
  const unavailable = state.busy || state.connection !== "ready";
  for (const id of ["approve-button", "execute-button", "run-demo"]) elements[id].disabled = unavailable;
  elements["clear-log"].disabled = state.busy || (state.connection !== "ready" && (recorded || !state.startupFailed));
  elements["retry-connection"].disabled = state.busy;
  elements["download-report"].disabled = unavailable || state.downloading || (!recorded && !state.results.length);
  write("run-demo-label", state.busy && state.operation === "demo" ? recorded ? "Replaying the demo…" : "Running the demo…" : recorded ? "Replay attack demo" : "Run attack demo");
  write("execute-label", state.busy && state.operation === "single" ? recorded ? "Reading receipt…" : "Waiting for NEAR…" : recorded ? "Inspect selected receipt" : "Submit selected request");
  write("suite-label", state.busy && state.operation === "suite" ? `${state.completed} / ${state.total} complete` : `${recorded ? "Explore" : "Run"} all ${state.scenarios.length} cases`);
  write("reset-label", recorded ? "Clear explored" : "New sandbox");
  for (const [id, operation] of [["run-demo", "demo"], ["execute-button", "single"], ["approve-button", "suite"], ["clear-log", "reset"]]) {
    elements[id].classList.toggle("is-busy", state.busy && state.operation === operation);
    elements[id].setAttribute("aria-busy", String(state.busy && state.operation === operation));
  }
  elements["download-report"].classList.toggle("is-busy", state.downloading);
  write("run-progress", state.progressMessage);
  elements["sequence-progress"].hidden = !state.total || Boolean(state.error);
  elements["sequence-progress"].max = state.total || 1;
  elements["sequence-progress"].value = state.completed;
}

function renderComparison() {
  if (!elements["demo-comparison"]) return;
  elements["demo-comparison"].hidden = !state.comparison;
  for (const id of ["baseline", "recipient-swap", "routine"]) {
    const button = document.querySelector(`[data-demo-case="${id}"]`);
    const result = state.results.findLast((entry) => entry.id === id);
    button.disabled = !result || state.busy;
    button.classList.toggle("complete", Boolean(result));
    button.classList.toggle("selected", state.selectedId === id);
    button.querySelector(".comparison-result").textContent = !result ? "Awaiting evidence"
      : id === "baseline" ? `${formatNear(result.attacker_delta)} NEAR lost`
        : id === "recipient-swap" ? `${formatNear(result.attacker_delta)} NEAR leaked` : `${formatNear(result.vendor_delta)} NEAR paid`;
  }
}
function render() {
  renderScenarios(); renderDetails(); renderDecision(); renderStatsAndPolicy();
  renderReceipt(); renderAudit(); renderConnection(); renderControls(); renderComparison();
}
function showToast(message) {
  write("toast", message);
  elements.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 5000);
}
function showError(error, connection = false) {
  state.error = error;
  if (connection || error.outcomeUnknown) state.connection = "error";
  state.progressMessage = error.message;
  render();
  showToast(error.message);
}

async function probeChain(token) {
  try {
    if (!runtime) {
      const { createRecordedRuntime } = await import("./evidence.js");
      const report = await requestJson(new URL("../data/proof.json", import.meta.url), { cache: "no-cache" });
      runtime = createRecordedRuntime(report);
    }
    const status = await runtime.status();
    if (token !== state.connectionToken) return;
    if (!status.ready) {
      if (status.error) { state.startupFailed = true; throw new Error(status.error); }
      if (Date.now() - state.connectionStarted > 120_000) throw new Error("The NEAR workspace is taking longer than expected. Try reconnecting.");
      state.pollTimer = setTimeout(() => { void probeChain(token); }, 1300);
      return;
    }
    const { scenarios } = await runtime.scenarios();
    if (token !== state.connectionToken) return;
    state.status = status; state.results = status.results ?? []; state.scenarios = scenarios;
    state.connection = "ready"; state.error = null; state.startupFailed = false;
    state.progressMessage = recorded ? "Original receipts loaded. Explore a case or replay the attack demo." : "Vault funded. Agent permissions verified from NEAR.";
    render();
  } catch (error) { if (token === state.connectionToken) showError(error, true); }
}
function connect() {
  if (state.busy) return;
  clearTimeout(state.pollTimer);
  state.connection = "starting"; state.error = null; state.connectionStarted = Date.now();
  state.progressMessage = recorded ? "Loading verified evidence…" : "Connecting to the NEAR workspace…";
  render();
  void probeChain(++state.connectionToken);
}

async function resetData() {
  const status = await runtime.reset();
  const { scenarios } = await runtime.scenarios();
  state.status = status; state.results = []; state.scenarios = scenarios; state.selectedResultKey = null;
  auditNodes.clear();
  state.connection = "ready"; state.startupFailed = false;
}
async function runSequence(ids, operation, fresh = false) {
  if (state.busy || state.connection !== "ready") return;
  state.busy = true; state.error = null; state.operation = operation; state.completed = 0; state.total = ids.length;
  if (operation !== "single") {
    state.filter = "all"; state.query = ""; elements["scenario-search"].value = "";
  }
  state.comparison = operation === "demo" || state.comparison;
  render();
  if (matchMedia("(max-width: 700px)").matches) scrollTo(elements["decision-panel"]);
  let failure;
  try {
    if (fresh && state.results.length) {
      state.progressMessage = recorded ? "Clearing the explored receipts…" : "Preparing a fresh funded vault…";
      render();
      await resetData();
    }
    for (const [index, id] of ids.entries()) {
      state.selectedId = id; state.selectedResultKey = null; state.runningId = id;
      state.progressMessage = `${index + 1} / ${ids.length} · ${selectedScenario().label} · ${recorded ? "reading original evidence" : "submitting to NEAR"}…`;
      render();
      // The short pause lets the three-case walkthrough show each observed outcome.
      if (recorded) await new Promise((resolve) => setTimeout(resolve, operation === "demo" ? 350 : 0));
      const { result, status } = await runtime.run(id);
      state.status = status;
      state.results = status.results ?? [...state.results, result];
      state.selectedResultKey = resultKey(result); state.completed = index + 1;
      render();
      if (!result.verified) throw new Error(`${result.label}: an expected check failed. Inspect the transaction evidence.`);
    }
    state.progressMessage = `${ids.length} ${ids.length === 1 ? "case" : "cases"} ${recorded ? "explored from verified captured receipts" : "verified from actual NEAR outcomes"}.`;
    showToast(operation === "demo"
      ? "Control: attacker paid. Scoped key: redirect blocked. Approved invoice: vendor paid."
      : operation === "suite" ? "All cases complete. The full receipt report is ready to download." : "Receipt ready. Inspect the checks, balances, and logs.");
  } catch (error) { failure = error; }
  finally { state.busy = false; state.runningId = null; state.operation = null; render(); }
  if (failure) showError(failure);
}

elements["execute-button"].addEventListener("click", () => { void runSequence([state.selectedId], "single"); });
elements["run-demo"].addEventListener("click", () => { void runSequence(["baseline", "recipient-swap", "routine"], "demo", true); });
elements["approve-button"].addEventListener("click", () => { void runSequence(ATTACK_CASES.map((scenario) => scenario.id), "suite", true); });
elements["clear-log"].addEventListener("click", async () => {
  if (state.busy || (state.connection !== "ready" && (recorded || !state.startupFailed))) return;
  state.busy = true; state.operation = "reset"; state.error = null; state.total = 0;
  state.progressMessage = recorded ? "Clearing explored receipts…" : "Preparing a fresh funded NEAR vault…";
  render();
  let failure;
  try {
    await resetData(); state.comparison = false;
    state.progressMessage = recorded ? "Workspace cleared. The original evidence is ready to explore again." : "Fresh vault ready. Agent restrictions verified.";
  } catch (error) { failure = error; }
  finally { state.busy = false; state.operation = null; render(); }
  if (failure) showError(failure, true);
});
elements["retry-connection"].addEventListener("click", () => {
  if (state.startupFailed && !recorded) elements["clear-log"].click();
  else connect();
});
elements["scenario-search"].addEventListener("input", (event) => {
  state.query = event.target.value; renderScenarios();
});
for (const button of document.querySelectorAll("[data-filter]")) {
  button.addEventListener("click", () => { state.filter = button.dataset.filter; renderScenarios(); });
}
elements["scenario-search"].addEventListener("keydown", (event) => {
  if (event.key === "Escape") { state.query = ""; event.target.value = ""; renderScenarios(); event.target.blur(); }
});
document.getElementById("reset-filters").addEventListener("click", () => {
  state.filter = "all"; state.query = ""; elements["scenario-search"].value = ""; renderScenarios(); elements["scenario-search"].focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !state.busy
      && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) && !event.target.isContentEditable) {
    event.preventDefault(); elements["scenario-search"].focus(); scrollTo(document.getElementById("attack-console"));
  }
});
elements["copy-hash"].addEventListener("click", async () => {
  const hash = selectedResult()?.transaction.transaction_hash;
  if (!hash) return;
  try { await navigator.clipboard.writeText(hash); showToast("Transaction hash copied."); }
  catch {
    const range = document.createRange(); range.selectNodeContents(elements["transaction-hash"]);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    showToast("Hash selected. Use your browser’s Copy command.");
  }
});
elements["download-report"].addEventListener("click", async () => {
  if (state.downloading) return;
  state.downloading = true; renderControls();
  try {
    const report = await runtime.report();
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = node("a"); link.href = objectUrl; link.download = "intentguard-near-proof.json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast("Original receipt and balance report downloaded.");
  } catch (error) { showToast(error.message); }
  finally { state.downloading = false; renderControls(); }
});
for (const button of document.querySelectorAll("[data-demo-case]")) {
  button.addEventListener("click", () => { selectScenario(button.dataset.demoCase); scrollTo(elements["decision-panel"]); });
}
for (const link of document.querySelectorAll(".workspace-nav a")) {
  link.addEventListener("click", () => {
    for (const item of document.querySelectorAll(".workspace-nav a")) { item.classList.remove("active"); item.removeAttribute("aria-current"); }
    link.classList.add("active"); link.setAttribute("aria-current", "location");
  });
}
document.getElementById("theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
window.addEventListener("online", () => { if (state.connection === "error" && !state.busy) connect(); });
window.addEventListener("pagehide", () => { clearTimeout(state.pollTimer); clearTimeout(state.toastTimer); });
setTheme(document.documentElement.dataset.theme);
connect();

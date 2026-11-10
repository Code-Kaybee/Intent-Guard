import {
  DEFAULT_POLICY,
  createExactApproval,
  consumeExactApproval,
  evaluateIntent,
  isExactApprovalValid,
} from "./policy.js";
import { SCENARIOS } from "./scenarios.js";

const state = {
  selectedId: "routine",
  approval: null,
  audit: [],
  toastTimer: null,
};

const elements = {
  scenarioList: document.querySelector("#scenario-list"),
  prompt: document.querySelector("#scenario-prompt"),
  signer: document.querySelector("#detail-signer"),
  receiver: document.querySelector("#detail-receiver"),
  amount: document.querySelector("#detail-amount"),
  expected: document.querySelector("#detail-expected"),
  banner: document.querySelector("#decision-banner"),
  symbol: document.querySelector("#decision-symbol"),
  label: document.querySelector("#decision-label"),
  subtitle: document.querySelector("#decision-subtitle"),
  tag: document.querySelector("#decision-tag"),
  evidence: document.querySelector("#evidence-list"),
  approvalBox: document.querySelector("#approval-box"),
  fingerprint: document.querySelector("#approval-fingerprint"),
  approve: document.querySelector("#approve-button"),
  execute: document.querySelector("#execute-button"),
  auditRows: document.querySelector("#audit-rows"),
  auditCount: document.querySelector("#audit-count"),
  toast: document.querySelector("#toast"),
};

function setTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.dataset.theme = isLight ? "light" : "dark";
  localStorage.setItem("intentguard-theme", isLight ? "light" : "dark");
  document.querySelector("#theme-icon").textContent = isLight ? "☾" : "☼";
  document.querySelector("#theme-label").textContent = isLight ? "Dark mode" : "Light mode";
  document.querySelector("#theme-toggle").setAttribute(
    "aria-label",
    `Switch to ${isLight ? "dark" : "light"} theme`,
  );
  document.querySelector('meta[name="theme-color"]').content = isLight ? "#f4f6f1" : "#10120f";
}

setTheme(localStorage.getItem("intentguard-theme") === "light" ? "light" : "dark");

function currentScenario() {
  return SCENARIOS.find(({ id }) => id === state.selectedId);
}

function renderScenarios() {
  elements.scenarioList.replaceChildren(...SCENARIOS.map((scenario) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `scenario-button${scenario.id === state.selectedId ? " selected" : ""}`;
    button.setAttribute("aria-pressed", String(scenario.id === state.selectedId));
    button.innerHTML = `<strong>${escapeHtml(scenario.label)}</strong>${escapeHtml(scenario.description)}`;
    button.addEventListener("click", () => selectScenario(scenario.id));
    return button;
  }));
}

function selectScenario(id) {
  state.selectedId = id;
  state.approval = null;
  render();
}

function renderDecision() {
  const scenario = currentScenario();
  const { intent } = scenario;
  const outcome = evaluateIntent(intent, DEFAULT_POLICY);
  const approvalValid = isExactApprovalValid(state.approval, intent);
  const style = outcome.decision;
  const icons = { allow: "✓", warn: "!", block: "×" };

  elements.banner.className = `decision-banner ${style}`;
  elements.symbol.textContent = icons[style];
  elements.label.textContent = style.toUpperCase();
  elements.subtitle.textContent = {
    allow: "Policy checks passed",
    warn: "Needs a human decision",
    block: "Signing refused by policy",
  }[style];
  elements.tag.textContent = outcome.rules[0]?.replaceAll("_", " ").toUpperCase() ?? "POLICY";
  elements.evidence.replaceChildren(...outcome.reasons.map((reason, index) => {
    const row = document.createElement("div");
    row.className = "evidence-item";
    row.innerHTML = `<span class="evidence-mark">${style === "allow" ? "✓" : style === "block" ? "×" : "!"}</span><span>${escapeHtml(reason)}</span><code class="rule-code">${escapeHtml(outcome.rules[index] ?? outcome.rules[0])}</code>`;
    return row;
  }));

  elements.approvalBox.hidden = style !== "warn";
  elements.approve.hidden = style !== "warn" || approvalValid;
  elements.approve.disabled = style !== "warn";
  elements.execute.disabled = style === "block" || (style === "warn" && !approvalValid);
  elements.execute.innerHTML = approvalValid
    ? "<span>⌑</span> Simulate approved signing"
    : "<span>⌑</span> Simulate signing";

  if (style === "warn" && approvalValid) {
    elements.fingerprint.textContent = `Exact intent approved · expires ${new Date(state.approval.expiresAt).toLocaleTimeString()}`;
    elements.fingerprint.classList.add("approved");
  } else if (style === "warn") {
    elements.fingerprint.textContent = "No approval issued · approval expires after 60 seconds";
    elements.fingerprint.classList.remove("approved");
  }

  return outcome;
}

function renderDetails() {
  const scenario = currentScenario();
  const { intent } = scenario;
  elements.prompt.textContent = scenario.prompt;
  elements.signer.textContent = intent.signer;
  elements.receiver.textContent = intent.receiver;
  elements.amount.textContent = `${Number(intent.amount).toFixed(2)} NEAR`;
  elements.expected.textContent = intent.expectedReceiver
    ? `${intent.expectedReceiver} · ${Number(intent.expectedAmount).toFixed(2)} NEAR`
    : "No invoice binding";
}

function renderAudit() {
  elements.auditCount.textContent = `${String(state.audit.length).padStart(2, "0")} EVENTS`;
  if (!state.audit.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No decisions yet. Select a scenario to inspect the policy trace.";
    row.append(cell);
    elements.auditRows.replaceChildren(row);
    return;
  }

  elements.auditRows.replaceChildren(...state.audit.slice(0, 8).map((event) => {
    const row = document.createElement("tr");
    const cells = [
      new Date(event.time).toLocaleTimeString(),
      event.scenario,
      event.receiver,
      event.rule,
    ];
    for (const value of cells) {
      const cell = document.createElement("td");
      if (value === event.receiver) {
        const code = document.createElement("code");
        code.textContent = value;
        cell.append(code);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    }
    const resultCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `result-pill ${event.decision}`;
    pill.textContent = event.decision.toUpperCase();
    resultCell.append(pill);
    row.append(resultCell);
    return row;
  }));
}

function renderStats() {
  const results = SCENARIOS.map(({ intent }) => evaluateIntent(intent));
  document.querySelector("#stat-decisions").textContent = String(results.length).padStart(2, "0");
  document.querySelector("#stat-blocked").textContent = String(results.filter(({ decision }) => decision === "block").length).padStart(2, "0");
  document.querySelector("#stat-reviews").textContent = String(results.filter(({ decision }) => decision === "warn").length).padStart(2, "0");
}

function render() {
  renderScenarios();
  renderDetails();
  renderDecision();
  renderAudit();
}

function addAuditEvent(action, outcome) {
  const scenario = currentScenario();
  state.audit.unshift({
    time: Date.now(),
    scenario: scenario.label,
    receiver: scenario.intent.receiver,
    rule: outcome.rules.join(", "),
    decision: action === "attempt" && outcome.decision === "block" ? "block" : outcome.decision,
  });
  renderAudit();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

elements.approve.addEventListener("click", () => {
  const { intent } = currentScenario();
  const approvedDetails = `${Number(intent.amount).toFixed(2)} NEAR → ${intent.receiver}`;
  if (!window.confirm(`Approve this one payment only?\n\n${approvedDetails}\n\nAny change to recipient, amount, network, or action requires a new approval.`)) {
    return;
  }
  state.approval = createExactApproval(intent);
  const outcome = evaluateIntent(intent);
  addAuditEvent("approval", outcome);
  render();
  showToast("One-time approval issued for the exact transaction details.");
});

elements.execute.addEventListener("click", () => {
  const { intent } = currentScenario();
  const outcome = evaluateIntent(intent);
  if (outcome.decision === "block") {
    addAuditEvent("attempt", outcome);
    showToast("Blocked before signing. Policy refusal recorded.");
    return;
  }
  if (outcome.decision === "warn" && !isExactApprovalValid(state.approval, intent)) {
    showToast("No valid approval for this exact payment.");
    return;
  }
  if (outcome.decision === "warn") {
    if (!consumeExactApproval(state.approval, intent)) {
      showToast("Approval is expired or has already been used.");
      return;
    }
    state.approval = null;
  }
  addAuditEvent("attempt", outcome);
  renderDecision();
  showToast("Simulation passed the gate. One-time approval consumed; nothing was signed.");
});

document.querySelector("#run-demo").addEventListener("click", () => {
  selectScenario("injection");
  const outcome = evaluateIntent(currentScenario().intent);
  addAuditEvent("attack", outcome);
  showToast("Attack stopped: payee did not match the invoice.");
});

document.querySelector("#clear-log").addEventListener("click", () => {
  state.audit = [];
  renderAudit();
});

document.querySelector("#policy-nav").addEventListener("click", () => {
  showToast("Policy: testnet only · 2 NEAR per payment · 5 NEAR daily.");
});

document.querySelector("#theme-toggle").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

renderStats();
render();

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker, KeyPair } from "near-workspaces";
import { transactions } from "near-api-js";
import { AgentWallet, PAYMENT_GAS, transactionEvidence } from "./agent.mjs";
import { ATTACK_CASES, attackCase } from "../src/attack-cases.js";
import { toYocto } from "../src/amount.js";

export const CONTRACT_PATH = fileURLToPath(new URL("../target/near/intentguard_vault.wasm", import.meta.url));
export const GAS_ALLOWANCE = toYocto("0.25");
const DEFAULT_POLICY = { per_payment_limit: toYocto("2"), daily_limit: toYocto("5") };

export class SandboxDemo {
  #queue = Promise.resolve();
  #counter = 0;

  constructor(worker) {
    this.worker = worker;
    this.results = [];
    this.startedAt = new Date().toISOString();
  }

  static async create() {
    let wasm;
    try {
      wasm = await readFile(CONTRACT_PATH);
    } catch {
      throw new Error("Build the vault first: npm run build:contract");
    }
    const worker = await Worker.init({ network: "sandbox" });
    const demo = new SandboxDemo(worker);
    try {
      const root = worker.rootAccount;
      demo.owner = await root.createSubAccount("owner", { initialBalance: BigInt(toYocto("50")) });
      demo.vault = await demo.owner.createSubAccount("vault", { initialBalance: BigInt(toYocto("10")) });
      demo.vendor = await root.createSubAccount("vendor", { initialBalance: BigInt(toYocto("3")) });
      demo.attacker = await root.createSubAccount("attacker", { initialBalance: BigInt(toYocto("3")) });
      demo.unprotected = await root.createSubAccount("unguarded", { initialBalance: BigInt(toYocto("10")) });
      demo.outsider = await root.createSubAccount("outsider", { initialBalance: BigInt(toYocto("3")) });
      demo.agentKey = KeyPair.fromRandom("ed25519");
      const deployment = await demo.vault.batch(demo.vault)
        .deployContract(wasm)
        .functionCall("new", {
          owner_id: demo.owner.accountId,
          agent_public_key: demo.agentKey.getPublicKey().toString(),
          ...DEFAULT_POLICY,
        }, { gas: PAYMENT_GAS })
        .addKey(demo.agentKey.getPublicKey(), transactions.functionCallAccessKey(
          demo.vault.accountId, ["execute_payment"], BigInt(GAS_ALLOWANCE),
        ))
        .transact();
      if (!deployment.succeeded) throw new Error(deployment.summary());
      demo.deploymentHash = deployment.transactionReceipt.hash;
      demo.wasmSha256 = createHash("sha256").update(wasm).digest("hex");
      demo.agent = await AgentWallet.create({
        accountId: demo.vault.accountId,
        keyPair: demo.agentKey,
        provider: worker.provider,
      });
      demo.baselineAgent = await AgentWallet.create({
        accountId: demo.unprotected.accountId,
        keyPair: await demo.unprotected.getKey(),
        provider: worker.provider,
      });
      demo.outsiderAgent = await AgentWallet.create({
        accountId: demo.outsider.accountId,
        keyPair: await demo.outsider.getKey(),
        provider: worker.provider,
      });
      const accessKey = await demo.vault.viewAccessKey(demo.vault.accountId, demo.agent.publicKey);
      const permission = accessKey.permission.FunctionCall;
      if (!permission || permission.receiver_id !== demo.vault.accountId
          || permission.method_names.length !== 1 || permission.method_names[0] !== "execute_payment"
          || permission.allowance !== GAS_ALLOWANCE) {
        throw new Error("The installed agent key does not match the required restrictions.");
      }
      return demo;
    } catch (error) {
      await worker.tearDown();
      throw error;
    }
  }

  async status() {
    const [vault, accessKey] = await Promise.all([
      this.vault.view("get_status", {}),
      this.vault.viewAccessKey(this.vault.accountId, this.agent.publicKey),
    ]);
    return {
      network: "sandbox",
      chain_label: "Local NEAR Sandbox",
      vault,
      accounts: {
        owner: this.owner.accountId,
        vault: this.vault.accountId,
        vendor: this.vendor.accountId,
        attacker: this.attacker.accountId,
        unprotected: this.unprotected.accountId,
      },
      agent_key: { public_key: this.agent.publicKey, permission: accessKey.permission },
      deployment_hash: this.deploymentHash,
      wasm_sha256: this.wasmSha256,
      results: this.results,
    };
  }

  describe(id) {
    const scenario = attackCase(id);
    const substituted = ["baseline", "recipient-swap", "forged-context", "direct-transfer"].includes(id);
    return {
      ...scenario,
      method: { baseline: "native_transfer", "direct-transfer": "native_transfer", "key-escalation": "add_full_access_key", "policy-bypass": "set_policy", "owner-only": "approve_invoice", "callback-forgery": "settle_payment" }[id] ?? "execute_payment",
      transaction_target: ["baseline", "direct-transfer", "contract-escape"].includes(id) ? this.attacker.accountId : this.vault.accountId,
      signer: id === "baseline" ? this.unprotected.accountId : ["owner-only", "callback-forgery"].includes(id) ? this.outsider.accountId : this.vault.accountId,
      payment_receiver: substituted ? this.attacker.accountId : this.vendor.accountId,
      amount: toYocto(id === "amount-escalation" ? "0.5" : id === "daily-limit" ? "0.01" : "0.08"),
      owner_invoice: ["baseline", "unapproved-invoice", "owner-only", "callback-forgery"].includes(id) ? null : {
        receiver_id: this.vendor.accountId,
        amount: toYocto(id === "daily-limit" ? "0.01" : "0.08"),
        owner_id: this.owner.accountId,
      },
    };
  }

  run(id) {
    attackCase(id);
    const task = this.#queue.then(() => this.#run(id));
    this.#queue = task.catch(() => {});
    return task;
  }

  async #run(id) {
    const scenario = attackCase(id);
    const startedAt = Date.now();
    const invoiceId = `case-${id}-${++this.#counter}`;
    const preparation = [];
    const cleanup = [];
    let receiverId = this.vendor.accountId;
    let amount = toYocto(id === "daily-limit" ? "0.01" : "0.08");
    let authorizedInvoice = null;
    let signer = this.agent;
    let target = this.vault.accountId;
    let method = "execute_payment";
    let args;
    let actions;

    const ownerCall = async (methodName, callArgs, step) => {
      const result = await this.owner.callRaw(this.vault, methodName, callArgs, { gas: PAYMENT_GAS });
      if (!result.succeeded) throw new Error(`Setup failed: ${result.summary()}`);
      preparation.push({ step, ...transactionEvidence(result.result, result.durationMs) });
    };
    const approve = async (approvedId, approvedReceiver, approvedAmount, ttlNs = 3_600_000_000_000n) => {
      const status = await this.vault.view("get_status", {});
      await ownerCall("approve_invoice", {
        invoice_id: approvedId,
        receiver_id: approvedReceiver,
        amount: approvedAmount,
        expires_at_ns: (BigInt(status.current_time_ns) + ttlNs).toString(),
      }, `Owner approves ${approvedId}`);
      return this.vault.view("get_invoice", { invoice_id: approvedId });
    };
    const setupPayment = async (approvedId, approvedAmount) => {
      await approve(approvedId, this.vendor.accountId, approvedAmount);
      const payment = await this.agent.pay({ invoice_id: approvedId, receiver_id: this.vendor.accountId, amount: approvedAmount });
      if (!payment.succeeded) throw new Error(`Setup payment failed: ${payment.error}`);
      const paidInvoice = await this.vault.view("get_invoice", { invoice_id: approvedId });
      if (paidInvoice.status !== "paid") throw new Error("Setup payment did not settle.");
      preparation.push({ step: `Pay prerequisite invoice ${approvedId}`, ...payment });
    };

    try {
      if (id === "failed-settlement") receiverId = `missing-${this.#counter}.${this.worker.rootAccount.accountId}`;
      if (!["baseline", "unapproved-invoice", "owner-only", "callback-forgery"].includes(id)) {
        authorizedInvoice = await approve(invoiceId, receiverId, amount, id === "expired" ? 5_000_000_000n : undefined);
      }
      args = { invoice_id: invoiceId, receiver_id: receiverId, amount };

      if (id === "baseline") {
        signer = this.baselineAgent;
        target = this.attacker.accountId;
        receiverId = this.attacker.accountId;
        method = "native_transfer";
        actions = [transactions.transfer(BigInt(amount))];
      } else if (["recipient-swap", "forged-context"].includes(id)) {
        receiverId = this.attacker.accountId;
        args.receiver_id = receiverId;
        if (id === "forged-context") {
          Object.assign(args, {
            expectedReceiver: receiverId,
            expectedAmount: "0.08",
            spentToday: 0,
            accountAgeDays: 999,
            priorPayments: 99,
          });
        }
      } else if (id === "amount-escalation") {
        amount = toYocto("0.5");
        args.amount = amount;
      } else if (id === "replay") {
        const firstPayment = await this.agent.pay(args);
        if (!firstPayment.succeeded) throw new Error(`Setup payment failed: ${firstPayment.error}`);
        const paidInvoice = await this.vault.view("get_invoice", { invoice_id: invoiceId });
        if (paidInvoice.status !== "paid") throw new Error("The prerequisite replay payment did not settle.");
        preparation.push({ step: "First use of the invoice settles", ...firstPayment });
      } else if (id === "expired") {
        await this.worker.provider.fastForward(100);
        const status = await this.vault.view("get_status", {});
        if (BigInt(status.current_time_ns) < BigInt(authorizedInvoice.expires_at_ns)) {
          throw new Error("Sandbox time did not advance beyond approval expiry.");
        }
        preparation.push({ step: "Advance sandbox time beyond invoice expiry", current_time_ns: status.current_time_ns });
      } else if (id === "revoked") {
        await ownerCall("revoke_invoice", { invoice_id: invoiceId }, "Owner revokes the invoice");
      } else if (id === "per-payment-limit") {
        await ownerCall("set_policy", { per_payment_limit: toYocto("0.05"), daily_limit: DEFAULT_POLICY.daily_limit }, "Owner reduces the per-payment limit");
        cleanup.push(() => this.owner.call(this.vault, "set_policy", DEFAULT_POLICY, { gas: PAYMENT_GAS }));
      } else if (id === "daily-limit") {
        const status = await this.vault.view("get_status", {});
        await ownerCall("set_policy", {
          per_payment_limit: toYocto("0.1"),
          daily_limit: (BigInt(status.spent_today) + BigInt(toYocto("0.16"))).toString(),
        }, "Owner grants exactly two additional 0.08 NEAR payments");
        cleanup.push(() => this.owner.call(this.vault, "set_policy", DEFAULT_POLICY, { gas: PAYMENT_GAS }));
        await setupPayment(`${invoiceId}-first`, toYocto("0.08"));
        await setupPayment(`${invoiceId}-second`, toYocto("0.08"));
      } else if (id === "direct-transfer") {
        target = this.attacker.accountId;
        receiverId = this.attacker.accountId;
        method = "native_transfer";
        actions = [transactions.transfer(BigInt(amount))];
      } else if (id === "key-escalation") {
        method = "add_full_access_key";
        actions = [transactions.addKey(KeyPair.fromRandom("ed25519").getPublicKey(), transactions.fullAccessKey())];
      } else if (id === "policy-bypass") {
        method = "set_policy";
        args = { per_payment_limit: toYocto("1000"), daily_limit: toYocto("1000") };
      } else if (id === "contract-escape") {
        target = this.attacker.accountId;
      } else if (id === "attached-deposit") {
        actions = [transactions.functionCall(method, args, PAYMENT_GAS, BigInt(amount))];
      } else if (id === "pause") {
        await ownerCall("set_paused", { paused: true }, "Owner pauses the vault");
        cleanup.push(() => this.owner.call(this.vault, "set_paused", { paused: false }, { gas: PAYMENT_GAS }));
      } else if (id === "agent-revoked") {
        await ownerCall("revoke_agent_key", {}, "Owner revokes the agent's contract authority");
        cleanup.push(() => this.owner.call(this.vault, "set_agent_key", { agent_public_key: this.agent.publicKey }, { gas: PAYMENT_GAS }));
      } else if (id === "owner-only") {
        signer = this.outsiderAgent;
        method = "approve_invoice";
        const status = await this.vault.view("get_status", {});
        args = {
          invoice_id: invoiceId,
          receiver_id: this.attacker.accountId,
          amount,
          expires_at_ns: (BigInt(status.current_time_ns) + 3_600_000_000_000n).toString(),
        };
      } else if (id === "callback-forgery") {
        signer = this.outsiderAgent;
        method = "settle_payment";
        args = { invoice_id: invoiceId, reserved_day: "0" };
      } else if (id === "gas-budget") {
        const exhaustedKey = KeyPair.fromRandom("ed25519");
        const installed = await this.vault.batch(this.vault)
          .addKey(exhaustedKey.getPublicKey(), transactions.functionCallAccessKey(this.vault.accountId, ["execute_payment"], 0n))
          .transact();
        if (!installed.succeeded) throw new Error("Cannot install the exhausted allowance fixture.");
        preparation.push({ step: "Install a function-call key with zero gas allowance", ...transactionEvidence(installed.result) });
        signer = await AgentWallet.create({ accountId: this.vault.accountId, keyPair: exhaustedKey, provider: this.worker.provider });
        cleanup.push(async () => {
          const deleted = await this.vault.batch(this.vault).deleteKey(exhaustedKey.getPublicKey()).transact();
          if (!deleted.succeeded) throw new Error("Cannot clean up the exhausted key.");
        });
      }

      actions ??= [transactions.functionCall(method, args, PAYMENT_GAS, 0n)];
      const before = await this.#snapshot();
      const signingKey = await this.vault.viewAccessKey(signer.accountId, signer.publicKey);
      const submitted = await signer.submit(target, actions);
      if (id === "baseline") submitted.layer = "runtime";
      const after = await this.#snapshot();
      const invoice = id === "baseline" ? null : await this.vault.view("get_invoice", { invoice_id: invoiceId });
      const vendorDelta = (BigInt(after.balances.vendor) - BigInt(before.balances.vendor)).toString();
      const attackerDelta = (BigInt(after.balances.attacker) - BigInt(before.balances.attacker)).toString();
      const budgetDelta = (BigInt(after.vault.spent_today) - BigInt(before.vault.spent_today)).toString();
      const paidDelta = (BigInt(after.vault.total_paid) - BigInt(before.vault.total_paid)).toString();
      const observed = !submitted.succeeded ? "blocked"
        : id === "baseline" || invoice?.status === "paid" ? "paid"
          : invoice?.status === "failed" ? "failed_safely" : "unsettled";
      const checks = [
        { name: "expected_outcome", passed: observed === scenario.expected },
        { name: "enforcement_layer", passed: submitted.layer === scenario.layer },
      ];
      if (scenario.rule) {
        checks.push({ name: "specific_rejection", passed: (submitted.error ?? "").toLowerCase().includes(scenario.rule.toLowerCase()) });
      }
      if (scenario.kind === "attack") {
        checks.push(
          { name: "no_recipient_funds_moved", passed: vendorDelta === "0" && attackerDelta === "0" },
          { name: "no_payment_budget_consumed", passed: budgetDelta === "0" && paidDelta === "0" },
          { name: "policy_unchanged_by_attack", passed: before.vault.per_payment_limit === after.vault.per_payment_limit && before.vault.daily_limit === after.vault.daily_limit },
          { name: "no_key_escalation", passed: before.key_count === after.key_count },
        );
      } else if (scenario.kind === "benign") {
        checks.push(
          { name: "vendor_paid_exact_amount", passed: vendorDelta === amount && attackerDelta === "0" },
          { name: "invoice_consumed", passed: invoice?.status === "paid" },
          { name: "budget_accounted", passed: budgetDelta === amount && paidDelta === amount },
        );
      } else if (scenario.kind === "control") {
        checks.push({ name: "unprotected_attack_moves_funds", passed: attackerDelta === amount && vendorDelta === "0" });
      } else {
        checks.push(
          { name: "failed_transfer_moves_no_funds", passed: vendorDelta === "0" && attackerDelta === "0" && paidDelta === "0" },
          { name: "reservation_restored", passed: budgetDelta === "0" },
          { name: "failed_invoice_cannot_be_reused", passed: invoice?.status === "failed" },
        );
      }
      const result = {
        id,
        label: scenario.label,
        kind: scenario.kind,
        expected: scenario.expected,
        observed,
        verified: checks.every((check) => check.passed),
        checks,
        instruction: scenario.prompt,
        invoice_id: invoiceId,
        authorized_invoice: authorizedInvoice,
        proposed_tool_call: { signer_id: signer.accountId, transaction_target: target, method, args, payment_receiver: receiverId, amount },
        signing_key: { public_key: signer.publicKey, permission: signingKey.permission },
        invoice_after: invoice,
        before,
        after,
        vendor_delta: vendorDelta,
        attacker_delta: attackerDelta,
        payment_budget_delta: budgetDelta,
        preparation,
        transaction: submitted,
        duration_ms: Date.now() - startedAt,
        recorded_at: new Date().toISOString(),
      };
      this.results.push(result);
      return result;
    } finally {
      for (const restore of cleanup.reverse()) await restore();
    }
  }

  async #snapshot() {
    const [vault, vendor, attacker, keys] = await Promise.all([
      this.vault.view("get_status", {}),
      this.vendor.accountView(),
      this.attacker.accountView(),
      this.vault.viewAccessKeys(this.vault.accountId),
    ]);
    return {
      vault,
      balances: { vendor: vendor.amount, attacker: attacker.amount },
      key_count: keys.keys.length,
    };
  }

  async runSuite(onResult = () => {}) {
    const results = [];
    for (const scenario of ATTACK_CASES) {
      const result = await this.run(scenario.id);
      results.push(result);
      await onResult(result);
    }
    return this.report(results);
  }

  async report(results = this.results) {
    const status = await this.status();
    const attacks = results.filter((result) => result.kind === "attack");
    const benign = results.filter((result) => result.kind === "benign");
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      network: "sandbox",
      evidence_scope: "Deterministic adversarial tool calls against a real local NEAR runtime; not a measurement of LLM prompt-injection susceptibility.",
      contract: { account_id: this.vault.accountId, deployment_hash: this.deploymentHash, wasm_sha256: this.wasmSha256 },
      agent_key: status.agent_key,
      summary: {
        cases_total: results.length,
        cases_verified: results.filter((result) => result.verified).length,
        cases_failed: results.filter((result) => !result.verified).length,
        attacks_total: attacks.length,
        attacks_blocked: attacks.filter((result) => result.verified && result.observed === "blocked").length,
        benign_payments_total: benign.length,
        benign_payments_succeeded: benign.filter((result) => result.verified && result.observed === "paid").length,
        baseline_attacker_received: results.filter((result) => result.kind === "control").reduce((total, result) => total + BigInt(result.attacker_delta), 0n).toString(),
      },
      results,
    };
  }

  async close() {
    await this.#queue;
    await this.worker.tearDown();
  }
}

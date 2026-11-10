# IntentGuard

**IntentGuard is a pre-sign payment firewall for AI agents.** It checks a proposed NEAR payment against invoice details and spending policy before the agent can proceed. A warning requires a one-time human approval bound to the exact transaction details; a changed recipient or amount needs a new decision.

Built for the **NEAR Hackathon — AI Security & Defense** track.

## Run the demo

Requires Python 3 and Node.js 20 or newer. No packages need to be installed.

```sh
npm test
npm start
```

Open [http://localhost:4173](http://localhost:4173). Choose a scenario or click **Run attack demo** to see a recipient substitution blocked before the simulated signing step. Approvals expire after 60 seconds and do not carry over to a modified payment.

## What the prototype demonstrates

- **Transaction-level policy:** evaluates the recipient, invoice binding, action, network, amount, spending limits, and fixture risk signals.
- **Fail-closed checks:** blocks recipient substitution, known demo blocklist entries, changed contract code, unsupported actions/networks, and limit violations.
- **Exact one-time approval:** a human review only unlocks the selected payment details and expires after one minute.
- **Decision trace:** each evaluation shows the rule and reason; the audit log records approval and simulated execution attempts.
- **Attack scenarios:** routine invoice, prompt-injection recipient swap, amount escalation, changed code, and a new counterparty.

## Important prototype limits

This is a **simulation**, not a wallet or signing service. It does not connect to NEAR RPC, verify live account age or contract code, manage access keys, or submit transactions. Scenario data and risk signals are fixtures. The in-memory approval check demonstrates exact-intent binding but is not a cryptographic authorization mechanism. Never use this prototype to protect real funds.

## Next steps for a testnet release

1. Replace fixture signals with time-stamped NEAR testnet RPC/indexer evidence and make unavailable data explicit.
2. Put policy enforcement in the agent's signing path and use a function-call access key scoped to the minimum contract/methods.
3. Make the human approval a signed, expiring authorization over a canonical transaction digest, verified server-side immediately before signing.
4. Add a reproducible adversarial test report, including false positives, false negatives, and the source of each signal.

## Project layout

```text
index.html       Firewall interface
styles.css       Responsive visual design
src/policy.js    Policy evaluation and exact-intent approval model
src/scenarios.js Deterministic demo fixtures
src/app.js       Interactive demo and audit trail
test/            Focused policy tests
```

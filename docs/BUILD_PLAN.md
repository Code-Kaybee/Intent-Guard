# IntentGuard: the remaining 38 hours

## Decision

Stay in **AI Security & Defense**, but change the core task from a simulated counterparty score to an **invoice-capability wallet for compromised agents**.

The original interface communicates the idea well. Its money gate is browser code, its invoice and spending evidence are request fields, and no NEAR key or transaction is involved. That is useful design work, but insufficient evidence for a competitive security submission.

At 2026-11-13 09:20 UTC, the public directory returned 391 projects tagged `security`. The first page included Veto, Allowance, LeashPay, NEAR Agent Spend Guard and AgentGuard. These names establish overlap with the broad spending-firewall pitch; the directory exposes neither their repositories nor enough detail to rank implementation quality. Switching tracks on the basis of names or entry counts would be guesswork.

## The claim to demonstrate

An attacker may control every agent instruction and payment-tool argument. The agent holds a function-call key that can call only `execute_payment` on its vault. An owner independently registers an exact recipient, amount and expiry. The NEAR contract checks that stored authorization, reserves the daily budget before issuing a transfer, and consumes the invoice once.

The demo shows the same malicious payment succeeding with an unrestricted sandbox wallet and failing with the restricted vault. It then shows an approved vendor getting paid. Each result includes actual NEAR runtime evidence, balances and a transaction hash when the transaction reaches the chain.

## Priorities

1. **Hours 0–6:** build the vault contract, exact integer amounts and restricted-key agent executor. Verify a real local NEAR transfer.
2. **Hours 6–14:** test recipient substitution, forged invoice context, amount escalation, replay, expiry, aggregate spending, key bypass, pause and failed settlement. Produce a reproducible JSON report.
3. **Hours 14–22:** run the dashboard against the local chain; prepare a testnet deployment and record public receipts if time and a deployment account permit.
4. **Hours 22–30:** record a 60–90 second demo. Get one external builder to follow the README and report confusing steps. Fix what blocks reproduction.
5. **Hours 30–38:** freeze scope, rerun the proof, publish the repository, publish the demo post and submit before the deadline. Keep the demo available during judging.

## Submission positioning

Primary track: `security`. Use additional tracks only if the finished product demonstrates their workflow. Position the product around preventing unauthorized agent payments, with invoices as the concrete use case.

Keep the evidence narrower than the claim: deterministic malicious tool calls demonstrate behavior under agent compromise; they do not measure how often an LLM falls for prompt injection. A local NEAR Sandbox runs real NEAR transaction validation and WASM contracts; it is not public testnet evidence. Report both distinctions explicitly.

## Scope boundary

Native NEAR invoice payments, owner-controlled authorizations, a bounded gas allowance, and a reproducible attack console. Counterparty reputation, cross-chain swaps and TEE attestation are later work. The owner and contract deployment key remain trusted; the agent receives neither.

## Official references

- [Event, dates, tracks and judging guide](https://nearhackathon.com/)
- [Current rules, including local/testnet eligibility and submission steps](https://nearhackathon.com/HACKATHON.md)
- [Security track example prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md)
- [NEAR access-key restrictions and allowance caveats](https://docs.near.org/protocol/accounts-contracts/access-keys)
- [NEAR Workspaces](https://github.com/near/workspaces-js)

The official deadline is **14 November 2026, 23:59 UTC**, which is **15 November, 00:59 in Lagos**. The published guide says automated screening checks reproducibility and README claims before human judging. Prior hackathons used implementation, design, impact, originality and sustainability; those are guidance, not a published weighted rubric for this event.

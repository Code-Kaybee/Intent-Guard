# Testnet workflow

The project owner account is `intentguard.testnet`. The owner's key stays in the local NEAR CLI keychain. Scripts select the Rust CLI at `$HOME/.cargo/bin/near`; set `NEAR_CLI_BIN` if yours is elsewhere. The tested CLI is near-cli-rs 0.31.1.

For a different owner, set `INTENTGUARD_OWNER` before preparation. Use a separate project copy rather than replacing an existing credential set. No script accepts a mainnet network.

## Prepare and inspect

```sh
npm run build:contract
npm run prepare:testnet
```

The public plan is `artifacts/testnet/deployment-plan.json`. It specifies:

- Owner: `intentguard.testnet`.
- Vault: `vault.intentguard.testnet`, initially funded with **3 testnet NEAR** from the owner.
- Demo recipients: `vendor.vault.intentguard.testnet` and `attacker.vault.intentguard.testnet`, funded with **0.2 NEAR each from the vault**.
- Agent key: vault receiver only, `execute_payment` only, **0.25 NEAR gas allowance**.
- Policy: **2 NEAR per payment**, **5 NEAR per UTC day**, subject to available vault balance.

Separate local admin, agent and recipient key files have mode 0600 under the ignored `artifacts/testnet/` directory. The agent file contains only the restricted key. No owner key is exported. Do not publish this directory or hand the admin file to an agent.

## Deploy

```sh
npm run deploy:testnet
```

The CLI uses `sign-with-keychain` to create the vault with the prepared admin public key. The local admin key then atomically deploys the contract, initializes the owner/policy and installs the restricted key. It creates the demo recipient accounts and verifies the deployed code and agent permissions.

An existing vault must match the saved keys and code. The script refuses to overwrite a different contract. Keys are written before funding so an interrupted run remains recoverable.

## Record actual payments and refusals

```sh
npm run demo:testnet
```

The owner signs a new exact 0.08 NEAR invoice through the CLI keychain. The agent then attempts a recipient substitution, a direct native transfer, the valid invoice and a replay with a new transaction nonce. Assertions check specific refusals, invoice state, vendor receipt and unchanged attacker balance. Exactly **0.08 testnet NEAR** is paid to the vendor on a successful run, plus transaction gas.

The public result is `artifacts/testnet/testnet-proof.json`. The direct-transfer attempt is rejected before inclusion and has no receipt hash. Contract refusals and the valid payment have hashes.

## Verify without credentials

```sh
npm run verify:testnet -- artifacts/testnet/testnet-proof.json
```

The verifier only reads `https://rpc.testnet.near.org`. It checks the deployed WASM digest, stored invoice, installed agent key, transaction signer/method and actual included failure reasons. Once the public evidence is checked into `docs/testnet-evidence.json`, `npm run verify:testnet` uses that bundle by default.

Keep the deployed code and evidence available through judging. The local dashboard's Sandbox results and these public testnet results are explicitly separate.

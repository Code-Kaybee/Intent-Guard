import { readFile, writeFile } from "node:fs/promises";
import { transactions, utils } from "near-api-js";
import { CONTRACT_PATH } from "../lib/sandbox.mjs";
import { PAYMENT_GAS } from "../lib/agent.mjs";
import { prepareTestnet, testnetProvider, runOwnerCli, signingWallet, accountExists, hasCode, deployedCodeHash, view, TESTNET_DIRECTORY } from "../lib/testnet.mjs";

const plan = await prepareTestnet();
const provider = testnetProvider();
console.log(JSON.stringify({ network: plan.network, owner: plan.accounts.owner, vault: plan.accounts.vault, initial_vault_funding: "3 NEAR", agent_method: "execute_payment", agent_gas_allowance: "0.25 NEAR", wasm_sha256: plan.wasm_sha256 }, null, 2));
let vaultAccount = await accountExists(provider, plan.accounts.vault);
if (!vaultAccount) {
  await runOwnerCli([
    "account", "create-account", "fund-myself", plan.accounts.vault, "3 NEAR",
    "use-manually-provided-public-key", plan.public_keys.admin, "sign-as", plan.accounts.owner,
    "network-config", "testnet", "sign-with-keychain", "send",
  ]);
  vaultAccount = await accountExists(provider, plan.accounts.vault);
  if (!vaultAccount) throw new Error("The testnet RPC cannot see the newly created vault.");
}
const admin = await signingWallet("admin", provider);
await provider.query({ request_type: "view_access_key", finality: "optimistic", account_id: admin.accountId, public_key: admin.publicKey });
let deployment = null;
if (!hasCode(vaultAccount)) {
  deployment = await admin.submit(plan.accounts.vault, [
    transactions.deployContract(await readFile(CONTRACT_PATH)),
    transactions.functionCall("new", { owner_id: plan.accounts.owner, agent_public_key: plan.public_keys.agent, ...plan.policy }, PAYMENT_GAS, 0n),
    transactions.addKey(utils.PublicKey.fromString(plan.public_keys.agent), transactions.functionCallAccessKey(plan.accounts.vault, ["execute_payment"], BigInt(plan.agent_permission.allowance))),
  ]);
  if (!deployment.succeeded) throw new Error(`Deployment failed: ${deployment.error}`);
}
if (await deployedCodeHash(provider, plan.accounts.vault) !== plan.wasm_sha256) {
  throw new Error("The existing vault contains a different contract. It was not overwritten.");
}
const status = await view(provider, plan.accounts.vault, "get_status");
if (status.owner_id !== plan.accounts.owner || status.agent_public_key !== plan.public_keys.agent) {
  throw new Error("The existing vault belongs to a different owner or agent setup.");
}
const receipts = [];
for (const role of ["vendor", "attacker"]) {
  if (!await accountExists(provider, plan.accounts[role])) {
    const receipt = await admin.submit(plan.accounts[role], [
      transactions.createAccount(), transactions.transfer(BigInt(plan.demo_recipient_funding_each)),
      transactions.addKey(utils.PublicKey.fromString(plan.public_keys[role]), transactions.fullAccessKey()),
    ]);
    if (!receipt.succeeded) throw new Error(`Cannot create ${role}: ${receipt.error}`);
    receipts.push({ role, ...receipt });
  }
}
const accessKey = await provider.query({ request_type: "view_access_key", finality: "optimistic", account_id: plan.accounts.vault, public_key: plan.public_keys.agent });
const permission = accessKey.permission.FunctionCall;
if (!permission || permission.receiver_id !== plan.accounts.vault || permission.method_names.join(",") !== "execute_payment" || permission.allowance === null) {
  throw new Error("The installed testnet agent key is not scoped as expected.");
}
await writeFile(new URL("deployment.json", TESTNET_DIRECTORY), `${JSON.stringify({ ...plan, deployment, recipient_creation_receipts: receipts, agent_key: { public_key: plan.public_keys.agent, permission: accessKey.permission }, deployed_at: new Date().toISOString() }, null, 2)}\n`);
console.log(`Testnet vault ready: https://testnet.nearblocks.io/address/${plan.accounts.vault}`);
console.log("Next: npm run demo:testnet");

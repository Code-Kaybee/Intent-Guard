import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair, providers } from "near-api-js";
import { CONTRACT_PATH, GAS_ALLOWANCE } from "./sandbox.mjs";
import { AgentWallet } from "./agent.mjs";
import { toYocto } from "../src/amount.js";

export const TESTNET_RPC = "https://rpc.testnet.near.org";
export const TESTNET_DIRECTORY = new URL("../artifacts/testnet/", import.meta.url);
export const DEFAULT_OWNER = "intentguard.testnet";
const EMPTY_CODE_HASH = "11111111111111111111111111111111";

export function testnetProvider() {
  return new providers.JsonRpcProvider({ url: TESTNET_RPC });
}

export async function view(provider, accountId, methodName, args = {}) {
  const result = await provider.query({
    request_type: "call_function", finality: "optimistic", account_id: accountId,
    method_name: methodName, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

export async function accountExists(provider, accountId) {
  try {
    return await provider.query({ request_type: "view_account", finality: "optimistic", account_id: accountId });
  } catch (error) {
    if (error.type === "UnknownAccount" || /does not exist|UNKNOWN_ACCOUNT/.test(error.message)) return null;
    throw error;
  }
}

export async function prepareTestnet() {
  const ownerId = process.env.INTENTGUARD_OWNER ?? DEFAULT_OWNER;
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(ownerId) || ownerId.length > 45) {
    throw new Error("INTENTGUARD_OWNER must be a named testnet account with room for vault subaccounts.");
  }
  await mkdir(TESTNET_DIRECTORY, { recursive: true, mode: 0o700 });
  const vaultId = `vault.${ownerId}`;
  const accounts = { owner: ownerId, vault: vaultId, vendor: `vendor.${vaultId}`, attacker: `attacker.${vaultId}` };
  const publicKeys = {};
  for (const role of ["admin", "agent", "vendor", "attacker"]) {
    const accountId = ["admin", "agent"].includes(role) ? vaultId : accounts[role];
    const path = new URL(`${role}.json`, TESTNET_DIRECTORY);
    let credentials;
    try {
      credentials = JSON.parse(await readFile(path, "utf8"));
      if (credentials.account_id !== accountId || credentials.network_id !== "testnet") {
        throw new Error("Existing credentials belong to a different testnet setup. Use a separate project copy.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const key = KeyPair.fromRandom("ed25519");
      credentials = { network_id: "testnet", account_id: accountId, public_key: key.getPublicKey().toString(), private_key: key.toString() };
      await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    }
    if (KeyPair.fromString(credentials.private_key).getPublicKey().toString() !== credentials.public_key) {
      throw new Error(`The ${role} credential file does not match its public key.`);
    }
    publicKeys[role] = credentials.public_key;
  }
  const wasm = await readFile(CONTRACT_PATH);
  const plan = {
    network: "testnet", rpc: TESTNET_RPC, accounts, public_keys: publicKeys,
    wasm_sha256: createHash("sha256").update(wasm).digest("hex"),
    initial_vault_funding: toYocto("3"),
    demo_recipient_funding_each: toYocto("0.2"),
    agent_permission: { receiver_id: vaultId, method_names: ["execute_payment"], allowance: GAS_ALLOWANCE },
    policy: { per_payment_limit: toYocto("2"), daily_limit: toYocto("5") },
    owner_signing: "near-cli-rs sign-with-keychain; owner key is never exported",
  };
  await writeFile(new URL("deployment-plan.json", TESTNET_DIRECTORY), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

export async function signingWallet(role, provider) {
  const credentials = JSON.parse(await readFile(new URL(`${role}.json`, TESTNET_DIRECTORY), "utf8"));
  if (credentials.network_id !== "testnet") throw new Error("Only testnet credentials are accepted.");
  return AgentWallet.create({ accountId: credentials.account_id, keyPair: KeyPair.fromString(credentials.private_key), provider, networkId: "testnet" });
}

export async function runOwnerCli(args) {
  const candidates = process.env.NEAR_CLI_BIN ? [process.env.NEAR_CLI_BIN] : [join(homedir(), ".cargo/bin/near"), "/usr/local/bin/near"];
  let executable;
  for (const candidate of candidates) {
    try { await access(candidate); executable = candidate; break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!executable) throw new Error("Set NEAR_CLI_BIN to your near-cli-rs executable with access to the owner keychain.");
  const child = spawn(executable, args, { stdio: ["inherit", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); process.stderr.write(chunk); });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`NEAR CLI exited with code ${code}.`)));
  });
  return output;
}

export async function approveTestnetInvoice(plan, invoice) {
  const invoicePath = new URL("owner-invoice.json", TESTNET_DIRECTORY);
  await writeFile(invoicePath, `${JSON.stringify(invoice, null, 2)}\n`);
  const output = await runOwnerCli([
    "contract", "call-function", "as-transaction", plan.accounts.vault, "approve_invoice", "file-args", fileURLToPath(invoicePath),
    "prepaid-gas", "60 Tgas", "attached-deposit", "0 NEAR", "sign-as", plan.accounts.owner,
    "network-config", "testnet", "sign-with-keychain", "send",
  ]);
  return output.replace(/\x1b\[[0-9;]*m/g, "").match(/Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{40,50})/)?.[1] ?? null;
}

export async function deployedCodeHash(provider, accountId) {
  const code = await provider.query({ request_type: "view_code", finality: "optimistic", account_id: accountId });
  return createHash("sha256").update(Buffer.from(code.code_base64, "base64")).digest("hex");
}

export function hasCode(account) {
  return Boolean(account && account.code_hash !== EMPTY_CODE_HASH);
}

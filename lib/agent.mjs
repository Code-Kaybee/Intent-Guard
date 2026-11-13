import { InMemorySigner, keyStores, transactions, utils } from "near-api-js";

export const PAYMENT_GAS = 60_000_000_000_000n;

export class AgentWallet {
  #signer;
  #queue = Promise.resolve();

  constructor({ accountId, publicKey, provider, signer, networkId }) {
    this.accountId = accountId;
    this.publicKey = publicKey;
    this.provider = provider;
    this.networkId = networkId;
    this.#signer = signer;
  }

  static async create({ accountId, keyPair, provider, networkId = "sandbox" }) {
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(networkId, accountId, keyPair);
    return new AgentWallet({
      accountId,
      publicKey: keyPair.getPublicKey().toString(),
      provider,
      networkId,
      signer: new InMemorySigner(keyStore),
    });
  }

  pay(args) {
    return this.submit(this.accountId, [transactions.functionCall("execute_payment", args, PAYMENT_GAS, 0n)]);
  }

  submit(receiverId, actions) {
    const attempt = this.#queue.then(() => this.#submit(receiverId, actions));
    this.#queue = attempt.catch(() => {});
    return attempt;
  }

  async #submit(receiverId, actions) {
    const startedAt = Date.now();
    try {
      const accessKey = await this.provider.query({
        request_type: "view_access_key",
        finality: "optimistic",
        account_id: this.accountId,
        public_key: this.publicKey,
      });
      const [, signedTransaction] = await transactions.signTransaction(
        receiverId,
        BigInt(accessKey.nonce) + 1n,
        actions,
        utils.serialize.base_decode(accessKey.block_hash),
        this.#signer,
        this.accountId,
        this.networkId,
      );
      const result = await this.provider.sendTransaction(signedTransaction);
      return transactionEvidence(result, Date.now() - startedAt);
    } catch (error) {
      return {
        accepted: false,
        succeeded: false,
        layer: "runtime",
        transaction_hash: null,
        duration_ms: Date.now() - startedAt,
        logs: [],
        error: `${error.type ?? error.name}: ${error.message}`,
        receipt_failures: [],
      };
    }
  }
}

export function transactionEvidence(result, durationMs = 0) {
  const outcomes = [result.transaction_outcome, ...(result.receipts_outcome ?? [])].filter(Boolean);
  const failures = outcomes.flatMap((receipt) => receipt.outcome.status?.Failure ? [receipt.outcome.status.Failure] : []);
  return {
    accepted: true,
    succeeded: !result.status?.Failure,
    layer: "contract",
    transaction_hash: result.transaction.hash,
    duration_ms: durationMs,
    logs: outcomes.flatMap((receipt) => receipt.outcome.logs ?? []),
    error: result.status?.Failure ? JSON.stringify(result.status.Failure) : null,
    receipt_failures: failures,
    final_status: result.status,
    receipt_ids: outcomes.map((receipt) => receipt.id),
  };
}

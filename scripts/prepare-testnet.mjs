import { prepareTestnet } from "../lib/testnet.mjs";

const plan = await prepareTestnet();
console.log(JSON.stringify(plan, null, 2));
console.log("Public deployment plan: artifacts/testnet/deployment-plan.json");
console.log("Separate admin and agent credentials are stored locally with mode 0600. The owner key remains in the CLI keychain.");

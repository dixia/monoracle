import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error("Set PRIVATE_KEY env var"); process.exit(1); }
const RPC_URL = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = Number(process.env.CHAIN_ID || 10143);

const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || "0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb";

function getAbi(name) {
  const p = path.join(rootDir, "artifacts", "contracts", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const quoteIdArg = process.argv[2] ? BigInt(process.argv[2]) : null;

  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();

  const oracleAbi = getAbi("Monoracle");
  const oracle = new ethers.Contract(ORACLE_ADDRESS, oracleAbi.abi, wallet);

  let quoteId;

  if (quoteIdArg !== null) {
    quoteId = quoteIdArg;
    console.log(`Using provided quoteId: ${quoteId}`);
  } else {
    const nextId = await oracle.nextQuoteId();
    if (nextId === 0n) {
      console.error("No quotes exist yet. Submit a quote on the frontend first.");
      process.exit(1);
    }
    quoteId = nextId - 1n;
    console.log(`Latest quoteId from contract: ${quoteId}`);
  }

  const q = await oracle.quotes(quoteId);
  console.log(`\nQuote #${quoteId}:`);
  console.log(`  provider:    ${q.provider}`);
  console.log(`  baseToken:   ${q.baseToken}`);
  console.log(`  quoteToken:  ${q.quoteToken}`);
  console.log(`  baseAmount:  ${ethers.formatEther(q.baseAmount)}`);
  console.log(`  quoteAmount: ${ethers.formatEther(q.quoteAmount)}`);
  console.log(`  price:       ${ethers.formatEther(q.price)}`);
  console.log(`  startSlot:   ${q.startSlot}`);
  console.log(`  status:      ${q.status}`);

  const currentBlock = await provider.getBlockNumber();
  console.log(`\nCurrent block:  ${currentBlock}`);
  console.log(`Window end:     ${Number(q.startSlot) + 2}`);
  const windowPassed = currentBlock > Number(q.startSlot) + 2;
  console.log(`Window passed:  ${windowPassed}`);

  if (q.status !== 0n) {
    console.error(`Quote is not ACTIVE (status=${q.status}). Nothing to settle.`);
    process.exit(1);
  }

  if (!windowPassed) {
    const needed = Number(q.startSlot) + 3 - currentBlock;
    console.log(`Waiting ${needed} blocks for verification window to pass...`);
    await new Promise(r => setTimeout(r, needed * 500));
  }

  console.log("\n=== Step 3: settleValidQuote ===");
  const settleTx = await oracle.settleValidQuote(quoteId, {
    gasLimit: 100000,
  });
  console.log(`Tx sent: ${settleTx.hash}`);
  const settleRcpt = await settleTx.wait();
  console.log(`Confirmed in block ${settleRcpt.blockNumber}`);

  console.log("\n=== Step 4: Read Latest Price ===");
  const baseToken = q.baseToken;
  const quoteToken = q.quoteToken;
  const [price, settledSlot, exists] = await oracle.getLatestPrice(baseToken, quoteToken);
  console.log(`  price:       ${ethers.formatEther(price)}`);
  console.log(`  settledSlot: ${settledSlot}`);
  console.log(`  exists:      ${exists}`);

  console.log("\n=== Step 5: withdrawProviderFunds ===");
  const withdrawTx = await oracle.withdrawProviderFunds(quoteId, {
    gasLimit: 100000,
  });
  console.log(`Tx sent: ${withdrawTx.hash}`);
  const withdrawRcpt = await withdrawTx.wait();
  console.log(`Confirmed in block ${withdrawRcpt.blockNumber}`);

  const finalQ = await oracle.quotes(quoteId);
  console.log(`\nFinal quote status: ${finalQ.status}`);
  console.log(`(5 = SETTLED_WITHDRAWN)`);

  console.log("\n=== E2E Complete ===");
}

main().catch(e => {
  console.error("E2E test failed:", e.shortMessage || e.message);
  if (e.info) console.error("  Info:", JSON.stringify(e.info, null, 2));
  process.exit(1);
});

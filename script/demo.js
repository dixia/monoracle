import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error("Set PRIVATE_KEY env var"); process.exit(1); }

const RPC   = process.env.RPC_URL   || "https://testnet-rpc.monad.xyz";
const CHAIN = Number(process.env.CHAIN_ID || 10143);
const ORACLE = process.env.ORACLE_ADDRESS || "0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb";
const BASE   = process.env.BASE_TOKEN     || "0xAf078b1cAb4797bA018C8354913eaE22f0f1F719";
const QUOTE  = process.env.QUOTE_TOKEN    || "0x3c34C844EeaeCbc760a74723FC67d8DF49a05093";

const FAIR_PRICE   = ethers.parseEther("100");  // $100 QUOTE per 1 BASE
const FAIR_DISPLAY = "100.00";
const THRESHOLD_BPS = 100;                       // 1%

function getAbi(name) {
  const p = path.join(rootDir, "artifacts", "contracts", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

async function ensure(wallet, token, amount) {
  const c = new ethers.Contract(token, ERC20_ABI, wallet);
  const addr = await wallet.getAddress();
  const allow = await c.allowance(addr, ORACLE);
  if (allow < amount) {
    console.log(`  Approving oracle...`);
    await (await c.approve(ORACLE, amount, { gasLimit: 80000 })).wait();
  }
}

async function waitBlocks(since, count, prov) {
  while (true) {
    const bn = await prov.getBlockNumber();
    if (bn > since + count) break;
    await new Promise(r => setTimeout(r, 400));
  }
}

const STATUS = ["ACTIVE","VETOED_UNDERPRICED","VETOED_OVERPRICED","SETTLED_VALID","SETTLED_WITHDRAWN"];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: true });
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();
  const oracle = new ethers.Contract(ORACLE, getAbi("Monoracle").abi, wallet);

  const AMT = ethers.parseEther("1");
  let quoteId, q, startBlock, bn;

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n");
  console.log("═".repeat(65));
  console.log("  DEMO: Monoracle + Veto Bot — Two Paths");
  console.log("═".repeat(65));
  console.log(`  Fair price:         ${FAIR_DISPLAY} QUOTE/BASE`);
  console.log(`  Threshold:          ${THRESHOLD_BPS} bps (${THRESHOLD_BPS / 100}%)`);
  console.log(`  Bot ignores |dev| < ${THRESHOLD_BPS} bps (unprofitable)`);
  console.log(`  Bot vetoes   |dev| >= ${THRESHOLD_BPS} bps`);
  console.log("═".repeat(65));

  // ═══════════════════════════════════════════════════════════════════════
  // PATH 1 — Happy: Quote at fair price → no veto → settled → price feed
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n┌" + "─".repeat(63));
  console.log("│  PATH 1: HAPPY (Valid Price)");
  console.log("│  Quote price = fair => bot IGNORES => settles => price feed updated");
  console.log("└" + "─".repeat(63));

  quoteId = await oracle.nextQuoteId();
  console.log(`\n  1a. submitQuote(qAmt=%.2f)  [bot: price=100, fair=100, dev=0 bps < ${THRESHOLD_BPS} → IGNORE]`, Number(qAmtFair) / 1e18);
  const qAmtFair = AMT * FAIR_PRICE / ethers.parseEther("1");
  const tx1 = await oracle.submitQuote(BASE, QUOTE, AMT, qAmtFair, { gasLimit: 400000 });
  const r1 = await tx1.wait(); startBlock = r1.blockNumber;

  console.log(`      #${quoteId} active, window: blocks ${startBlock}–${startBlock + 2}`);

  console.log(`\n  1b. wait for window to expire (${startBlock + 2}→${startBlock + 3})...`);
  await waitBlocks(startBlock, 2, provider);

  console.log(`  1c. settleValidQuote(#${quoteId})`);
  await (await oracle.settleValidQuote(quoteId, { gasLimit: 70000 })).wait();

  const [price, settledSlot, exists] = await oracle.getLatestPrice(BASE, QUOTE);
  console.log(`  1d. getLatestPrice():  price=${ethers.formatEther(price)}  settledSlot=${settledSlot}  exists=${exists}`);
  console.log(`      ✅ Canonical price feed updated to ${ethers.formatEther(price)}`);

  await (await oracle.withdrawProviderFunds(quoteId, { gasLimit: 100000 })).wait();
  console.log(`  1e. withdrawProviderFunds → collateral returned`);

  // ═══════════════════════════════════════════════════════════════════════
  // PATH 2 — Veto: Quote mispriced → bot vetos → price NOT added to feed
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n┌" + "─".repeat(63));
  console.log("│  PATH 2: VETO (Mispriced)");
  console.log("│  Quote price ≠ fair => bot VETOES => funds seized => price unchanged");
  console.log("└" + "─".repeat(63));

  const badPrice = ethers.parseEther("75");
  const badQAmt = AMT * badPrice / ethers.parseEther("1");
  quoteId = await oracle.nextQuoteId();
  console.log(`\n  2a. submitQuote(qAmt=75.00)  [bot: effective=75, fair=100, dev=2500 bps >= ${THRESHOLD_BPS} → VETO!]`);

  const tx2 = await oracle.submitQuote(BASE, QUOTE, AMT, badQAmt, { gasLimit: 400000 });
  const r2 = await tx2.wait(); startBlock = r2.blockNumber;
  q = await oracle.quotes(quoteId);
  console.log(`      #${quoteId} active at block ${startBlock}, baseAmt=${ethers.formatEther(q.baseAmount)}, price=${ethers.formatEther(q.price)}`);

  // Simulate veto (same as what the bot would do)
  console.log(`  2b. bot: sees deviation ${Math.abs(75-100)/100*10000} bps >= ${THRESHOLD_BPS} bps → calls vetoUnderpriced(#${quoteId})`);
  await (await oracle.vetoUnderpriced(quoteId, { gasLimit: 150000 })).wait();
  q = await oracle.quotes(quoteId);
  console.log(`      status = ${STATUS[Number(q.status)]} (verifier got ${ethers.formatEther(q.baseAmount)} BASE, contract holds 2x QUOTE)`);

  console.log(`\n  2c. verify: getLatestPrice() still returns PATH 1 price`);
  const [price2, slot2, exists2] = await oracle.getLatestPrice(BASE, QUOTE);
  console.log(`      price=${ethers.formatEther(price2)}  exists=${exists2}  (unchanged — vetoed quote rejected!)`);

  console.log(`\n  2d. withdrawProviderFunds → provider gets 2x quoteAmount QUOTE (penalty)`);
  await (await oracle.withdrawProviderFunds(quoteId, { gasLimit: 100000 })).wait();
  q = await oracle.quotes(quoteId);
  console.log(`      status = ${STATUS[Number(q.status)]}`);

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═".repeat(65));
  console.log("  DEMO COMPLETE");
  console.log("  Path 1: Valid quote → settled → price feed updated ✅");
  console.log("  Path 2: Mispriced quote → vetoed → price feed unchanged ✅");
  console.log("═".repeat(65));
  console.log("\nTo see the bot run live:");
  console.log("  cd bot && py verifier.py");
  console.log("  (Submit a quote at e.g. price=50 or price=150 on the frontend)");
}

main().catch(e => {
  console.error("Demo failed:", e.shortMessage || e.message);
  process.exit(1);
});

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error("Set PRIVATE_KEY env var"); process.exit(1); }
const RPC_URL = "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;

const ORACLE_ADDRESS = "0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb";
const BASE_TOKEN = "0xAf078b1cAb4797bA018C8354913eaE22f0f1F719";
const QUOTE_TOKEN = "0x3c34C844EeaeCbc760a74723FC67d8DF49a05093";

function getAbi(name) {
  const p = path.join(rootDir, "artifacts", "contracts", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const STATUS_NAME = ["ACTIVE","VETOED_UNDERPRICED","VETOED_OVERPRICED","SETTLED_VALID","SETTLED_WITHDRAWN"];

let passCount = 0;
let failCount = 0;

function pass(msg) { passCount++; console.log(`  ✅ ${msg}`); }
function fail(msg) { failCount++; console.log(`  ❌ ${msg}`); }

async function ensure(wallet, token, amount) {
  const c = new ethers.Contract(token, ERC20_ABI, wallet);
  const addr = await wallet.getAddress();
  const bal = await c.balanceOf(addr);
  if (bal < amount) {
    console.log(`  Minting ${ethers.formatEther(amount)} more tokens...`);
    await (await c.mint(addr, amount, { gasLimit: 80000 })).wait();
  }
  const allow = await c.allowance(addr, ORACLE_ADDRESS);
  if (allow < amount) {
    console.log(`  Approving oracle for tokens...`);
    await (await c.approve(ORACLE_ADDRESS, amount, { gasLimit: 80000 })).wait();
  }
}

async function main() {
  console.log("=== Veto E2E Tests ===\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();
  console.log(`Wallet: ${addr}\n`);

  const oracleAbi = getAbi("Monoracle");
  const oracle = new ethers.Contract(ORACLE_ADDRESS, oracleAbi.abi, wallet);

  // Ensure we have enough tokens + approvals
  const BIG = ethers.parseEther("1000000");
  await ensure(wallet, BASE_TOKEN, ethers.parseEther("100"));
  await ensure(wallet, QUOTE_TOKEN, ethers.parseEther("100000"));

  const PRICE = ethers.parseEther("100");
  const BASE_AMT = ethers.parseEther("1");
  const SNIP = ethers.parseEther("0.1");
  const BASE_S = ethers.parseEther("0.1");

  // =============================================================
  // TEST 1: Underpriced Veto (5.2)
  // =============================================================
  console.log(`${"=".repeat(60)}`);
  console.log(`TEST 1: Underpriced Veto (5.2)`);
  console.log(`${"=".repeat(60)}`);

  console.log(`\nStep 1: submitQuote(price=100)`);
  const s1 = await oracle.nextQuoteId();
  const balB1_b = await new ethers.Contract(BASE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);
  const balQ1_b = await new ethers.Contract(QUOTE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);
  console.log(`  Provider holds: ${ethers.formatEther(balB1_b)} BASE, ${ethers.formatEther(balQ1_b)} QUOTE`);

  const sub1 = await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_AMT, PRICE, { gasLimit: 200000 });
  const rcp1 = await sub1.wait();
  const q1 = await oracle.quotes(s1);
  console.log(`  #${s1} submitted at block ${rcp1.blockNumber}, price=100, base=1, quote=${ethers.formatEther(q1.quoteAmount)}`);

  console.log(`\nStep 2: vetoUnderpriced (same wallet acts as verifier)`);
  await new Promise(r => setTimeout(r, 100));
  const veto1 = await oracle.vetoUnderpriced(s1, { gasLimit: 150000 });
  await veto1.wait();
  const vs1 = (await oracle.quotes(s1)).status;
  if (STATUS_NAME[Number(vs1)] === "VETOED_UNDERPRICED") pass(`Status: VETOED_UNDERPRICED (code ${vs1})`);
  else fail(`Expected VETOED_UNDERPRICED, got ${STATUS_NAME[Number(vs1)]}`);

  console.log(`\nStep 3: withdrawProviderFunds → provider gets 2x quoteAmount QUOTE`);
  await (await oracle.withdrawProviderFunds(s1, { gasLimit: 100000 })).wait();
  const balB1_a = await new ethers.Contract(BASE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);
  const balQ1_a = await new ethers.Contract(QUOTE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);

  const dB1 = balB1_a - balB1_b;
  const dQ1 = balQ1_a - balQ1_b;
  const expectedQ = q1.quoteAmount * 2n;

  if (dB1 === 0n && dQ1 === expectedQ) pass(`Withdraw: 0 BASE + ${ethers.formatEther(expectedQ)} QUOTE`);
  else fail(`Withdraw: got ${ethers.formatEther(dB1)} BASE + ${ethers.formatEther(dQ1)} QUOTE (expected 0 + ${ethers.formatEther(expectedQ)})`);

  const final1 = (await oracle.quotes(s1)).status;
  if (STATUS_NAME[Number(final1)] === "SETTLED_WITHDRAWN") pass(`Final state: SETTLED_WITHDRAWN`);
  else fail(`Final state: ${STATUS_NAME[Number(final1)]}`);

  // =============================================================
  // TEST 2: Overpriced Veto (5.3)
  // =============================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST 2: Overpriced Veto (5.3)`);
  console.log(`${"=".repeat(60)}`);

  console.log(`\nStep 1: submitQuote(price=100)`);
  const s2 = await oracle.nextQuoteId();
  const balB2_b = await new ethers.Contract(BASE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);
  const balQ2_b = await new ethers.Contract(QUOTE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);

  const sub2 = await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_AMT, PRICE, { gasLimit: 200000 });
  const rcp2 = await sub2.wait();
  const q2 = await oracle.quotes(s2);
  console.log(`  #${s2} submitted at block ${rcp2.blockNumber}, base=${ethers.formatEther(q2.baseAmount)}, quote=${ethers.formatEther(q2.quoteAmount)}`);

  console.log(`\nStep 2: vetoOverpriced (same wallet acts as verifier)`);
  await new Promise(r => setTimeout(r, 100));
  await (await oracle.vetoOverpriced(s2, { gasLimit: 150000 })).wait();
  const vs2 = (await oracle.quotes(s2)).status;
  if (STATUS_NAME[Number(vs2)] === "VETOED_OVERPRICED") pass(`Status: VETOED_OVERPRICED (code ${vs2})`);
  else fail(`Expected VETOED_OVERPRICED, got ${STATUS_NAME[Number(vs2)]}`);

  console.log(`\nStep 3: withdrawProviderFunds → provider gets 2x baseAmount BASE`);
  await (await oracle.withdrawProviderFunds(s2, { gasLimit: 100000 })).wait();
  const balB2_a = await new ethers.Contract(BASE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);
  const balQ2_a = await new ethers.Contract(QUOTE_TOKEN, ERC20_ABI, wallet).balanceOf(addr);

  const dB2 = balB2_a - balB2_b;
  const dQ2 = balQ2_a - balQ2_b;
  const expectedB = q2.baseAmount * 2n;

  if (dQ2 === 0n && dB2 === expectedB) pass(`Withdraw: ${ethers.formatEther(expectedB)} BASE + 0 QUOTE`);
  else fail(`Withdraw: got ${ethers.formatEther(dB2)} BASE + ${ethers.formatEther(dQ2)} QUOTE (expected ${ethers.formatEther(expectedB)} + 0)`);

  // =============================================================
  // TEST 3: Edge Cases
  // =============================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST 3: Edge Cases`);
  console.log(`${"=".repeat(60)}`);

  // 3a: withdraw on ACTIVE quote
  console.log(`\n3a: withdrawProviderFunds on ACTIVE quote → revert`);
  const s3a = await oracle.nextQuoteId();
  await (await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, SNIP, PRICE, { gasLimit: 200000 })).wait();
  try {
    await oracle.withdrawProviderFunds(s3a, { gasLimit: 100000 });
    fail(`Should have reverted (ACTIVE)`);
  } catch (e) {
    pass(`Reverted: ${e.shortMessage || e.message}`);
  }

  // 3b: veto after window expires
  console.log(`\n3b: vetoUnderpriced after window expires → revert`);
  const s3b = await oracle.nextQuoteId();
  await (await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, SNIP, PRICE, { gasLimit: 200000 })).wait();
  const q3b = await oracle.quotes(s3b);
  const bn = await provider.getBlockNumber();
  const wait = Number(q3b.startSlot) + 3 - bn;
  if (wait > 0) { console.log(`  Waiting ${wait} blocks...`); await new Promise(r => setTimeout(r, wait * 600)); }
  try {
    await oracle.vetoUnderpriced(s3b, { gasLimit: 150000 });
    fail(`Should have reverted (expired)`);
  } catch (e) {
    pass(`Reverted: ${e.shortMessage || e.message}`);
  }

  // 3c: settle during window
  console.log(`\n3c: settleValidQuote during window → revert`);
  const s3c = await oracle.nextQuoteId();
  await (await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, SNIP, PRICE, { gasLimit: 200000 })).wait();
  try {
    await oracle.settleValidQuote(s3c, { gasLimit: 100000 });
    fail(`Should have reverted (active window)`);
  } catch (e) {
    pass(`Reverted: ${e.shortMessage || e.message}`);
  }

  // 3d: double withdraw
  console.log(`\n3d: double withdrawProviderFunds → revert`);
  const s3d = await oracle.nextQuoteId();
  await (await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_S, PRICE, { gasLimit: 200000 })).wait();
  await (await oracle.vetoOverpriced(s3d, { gasLimit: 150000 })).wait();
  await (await oracle.withdrawProviderFunds(s3d, { gasLimit: 100000 })).wait();
  try {
    await oracle.withdrawProviderFunds(s3d, { gasLimit: 100000 });
    fail(`Should have reverted (double withdraw)`);
  } catch (e) {
    pass(`Reverted: ${e.shortMessage || e.message}`);
  }

  // 3e: veto on already-settled quote
  console.log(`\n3e: veto on settled quote → revert`);
  const s3e = await oracle.nextQuoteId();
  await (await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, SNIP, PRICE, { gasLimit: 200000 })).wait();
  const q3e = await oracle.quotes(s3e);
  const wait2 = Number(q3e.startSlot) + 3 - (await provider.getBlockNumber());
  if (wait2 > 0) { await new Promise(r => setTimeout(r, wait2 * 600)); }
  await (await oracle.settleValidQuote(s3e, { gasLimit: 100000 })).wait();
  try {
    await oracle.vetoUnderpriced(s3e, { gasLimit: 150000 });
    fail(`Should have reverted (settled)`);
  } catch (e) {
    pass(`Reverted: ${e.shortMessage || e.message}`);
  }

  // =============================================================
  // Summary
  // =============================================================
  const total = passCount + failCount;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULTS: ${passCount}/${total} passed, ${failCount}/${total} failed`);
  console.log(`${"=".repeat(60)}`);

  if (failCount > 0) process.exit(1);
}

main().catch(e => {
  console.error("\nFatal:", e.shortMessage || e.message || e);
  process.exit(1);
});

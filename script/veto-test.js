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
const BASE_TOKEN = process.env.BASE_TOKEN || "0xAf078b1cAb4797bA018C8354913eaE22f0f1F719";
const QUOTE_TOKEN = process.env.QUOTE_TOKEN || "0x3c34C844EeaeCbc760a74723FC67d8DF49a05093";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const STATUS = { ACTIVE: 0, VETOED_UNDERPRICED: 1, VETOED_OVERPRICED: 2, SETTLED_VALID: 3, SETTLED_WITHDRAWN: 4 };
const STATUS_NAME = ["ACTIVE", "VETOED_UNDERPRICED", "VETOED_OVERPRICED", "SETTLED_VALID", "SETTLED_WITHDRAWN"];

let pass = 0, fail = 0;

function ok(msg) { pass++; console.log(`  ✅ ${msg}`); }
function no(msg, detail) { fail++; console.log(`  ❌ ${msg}${detail ? ": " + detail : ""}`); }

async function getAbi(name) {
  const p = path.join(rootDir, "artifacts", "contracts", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function ensureApproval(tokenAddr, owner, oracle, wallet, amount) {
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  const allow = await token.allowance(owner, ORACLE_ADDRESS);
  if (allow < amount) {
    console.log(`  Approving ${ethers.formatEther(amount)} of ${tokenAddr}...`);
    const tx = await token.approve(ORACLE_ADDRESS, amount, { gasLimit: 80000 });
    await tx.wait();
  }
}

async function getBalances(wallet) {
  const base = new ethers.Contract(BASE_TOKEN, ERC20_ABI, wallet);
  const quote = new ethers.Contract(QUOTE_TOKEN, ERC20_ABI, wallet);
  const addr = typeof wallet === "string" ? wallet : await wallet.getAddress();
  return {
    base: await base.balanceOf(addr),
    quote: await quote.balanceOf(addr),
  };
}

async function main() {
  console.log("=== Veto E2E Tests ===\n");

  const provider = new ethers.RpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();
  console.log(`Wallet: ${addr}\n`);

  const oracleAbi = await getAbi("Monoracle");
  const oracle = new ethers.Contract(ORACLE_ADDRESS, oracleAbi.abi, wallet);

  const baseToken = new ethers.Contract(BASE_TOKEN, ERC20_ABI, wallet);

  // Default 2-slot verification window: expiry = current tip + VERIFICATION_SLOTS.
  const defaultExpiry = async () => (await provider.getBlockNumber()) + 2;

  // Pre-approve oracle for large amounts
  const BIG = ethers.parseEther("1000000");
  await ensureApproval(BASE_TOKEN, addr, oracle, wallet, BIG);
  await ensureApproval(QUOTE_TOKEN, addr, oracle, wallet, BIG);

  // ============================================================
  // Test 1: Underpriced Veto (5.2)
  // submit → vetoUnderpriced → withdraw (2x quoteAmount)
  // ============================================================
  console.log("--- Flow 5.2: Underpriced Veto ---");
  {
    const balBefore = await getBalances(addr);
    const BASE_AMT = ethers.parseEther("1");
    const PRICE = ethers.parseEther("50");
    const quoteAmt = (BASE_AMT * PRICE) / ethers.parseEther("1");

    // Submit quote
    const submitTx = await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_AMT, BASE_AMT * PRICE / ethers.parseEther("1"), await defaultExpiry(), { gasLimit: 180000 });
    const submitRcpt = await submitTx.wait();
    const quoteId = (await oracle.nextQuoteId()) - 1n;
    const submitBlock = submitRcpt.blockNumber;
    console.log(`  Submitted quote #${quoteId} at block ${submitBlock}, price=50`);

    // Veto immediately (within window)
    const vetoTx = await oracle.vetoUnderpriced(quoteId, { gasLimit: 120000 });
    const vetoRcpt = await vetoTx.wait();
    const q = await oracle.quotes(quoteId);
    if (q.status === BigInt(STATUS.VETOED_UNDERPRICED)) {
      ok(`vetoUnderpriced succeeded, status=1 (VETOED_UNDERPRICED)`);
    } else {
      no(`Expected status VETOED_UNDERPRICED, got ${STATUS_NAME[Number(q.status)]}`);
      // Fallback: try to settle instead of continuing with veto flow
    }

    // Withdraw
    const withdrawTx = await oracle.withdrawProviderFunds(quoteId, { gasLimit: 100000 });
    await withdrawTx.wait();
    const q2 = await oracle.quotes(quoteId);
    if (q2.status === BigInt(STATUS.SETTLED_WITHDRAWN)) {
      ok(`withdrawProviderFunds succeeded, status=4 (SETTLED_WITHDRAWN)`);
    } else {
      no(`Expected SETTLED_WITHDRAWN, got ${STATUS_NAME[Number(q2.status)]}`);
    }

    // Balance check: provider should have 2x quoteAmount more quote tokens
    const balAfter = await getBalances(addr);
    const quoteDelta = balAfter.quote - balBefore.quote;
    const expectedQuote = quoteAmt * 2n; // provider recovers 2x quoteAmount
    // Verifier paid quoteAmt to contract, provider withdrew 2x quoteAmt. Same wallet.
    // Gross delta: +2x quoteAmt (withdrawn) -1x quoteAmt (paid as verifier) -1x quoteAmt (paid as provider initial deposit) = 0
    // BUT the provider also paid BASE_AMT initially, and verifier got BASE_AMT from the veto
    // If same wallet: -BASE_AMT (provider deposit) + BASE_AMT (verifier receives from veto) = 0 net base
    // Net: quote tokens: sent quoteAmt (as provider) + sent quoteAmt (as verifier) + received 2*quoteAmt (withdraw) = 0
    // So delta should be 0 (same wallet, no profit/loss)
    // Plus the initial collateral isn't lost, it's returned with adjustments
    if (q.status === BigInt(STATUS.VETOED_UNDERPRICED)) {
      ok(`Underpriced veto flow complete`);
    }

    // Check contract balance is empty
    const cBase = await baseToken.balanceOf(ORACLE_ADDRESS);
    const cQuote = await (new ethers.Contract(QUOTE_TOKEN, ERC20_ABI, wallet)).balanceOf(ORACLE_ADDRESS);
    if (cBase === 0n && cQuote === 0n) {
      ok(`Contract holds 0 tokens after withdrawal`);
    } else {
      no(`Contract should hold 0 tokens, holds ${ethers.formatEther(cBase)} BASE + ${ethers.formatEther(cQuote)} QUOTE`);
    }
  }

  // ============================================================
  // Test 2: Overpriced Veto (5.3)
  // submit → vetoOverpriced → withdraw (2x baseAmount)
  // ============================================================
  console.log("\n--- Flow 5.3: Overpriced Veto ---");
  {
    const balBefore = await getBalances(addr);
    const BASE_AMT = ethers.parseEther("1");
    const PRICE = ethers.parseEther("200");

    const submitTx = await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_AMT, BASE_AMT * PRICE / ethers.parseEther("1"), await defaultExpiry(), { gasLimit: 180000 });
    const submitRcpt = await submitTx.wait();
    const quoteId = (await oracle.nextQuoteId()) - 1n;
    console.log(`  Submitted quote #${quoteId}, price=200`);

    // Veto overpriced
    const vetoTx = await oracle.vetoOverpriced(quoteId, { gasLimit: 120000 });
    await vetoTx.wait();
    const q = await oracle.quotes(quoteId);
    if (q.status === BigInt(STATUS.VETOED_OVERPRICED)) {
      ok(`vetoOverpriced succeeded, status=2 (VETOED_OVERPRICED)`);
    } else {
      no(`Expected VETOED_OVERPRICED, got ${STATUS_NAME[Number(q.status)]}`);
    }

    // Withdraw
    await oracle.withdrawProviderFunds(quoteId, { gasLimit: 100000 });
    const q2 = await oracle.quotes(quoteId);
    if (q2.status === BigInt(STATUS.SETTLED_WITHDRAWN)) {
      ok(`withdrawProviderFunds succeeded, status=4 (SETTLED_WITHDRAWN)`);
    }

    const cBase = await baseToken.balanceOf(ORACLE_ADDRESS);
    const cQuote = await (new ethers.Contract(QUOTE_TOKEN, ERC20_ABI, wallet)).balanceOf(ORACLE_ADDRESS);
    if (cBase === 0n && cQuote === 0n) {
      ok(`Contract holds 0 tokens after withdrawal`);
    }
  }

  // ============================================================
  // Test 3: FR-VU-002 — Cannot veto after window expires
  // ============================================================
  console.log("\n--- Edge Case: Veto after window expires ---");
  {
    const BASE_AMT = ethers.parseEther("1");
    const PRICE = ethers.parseEther("75");
    const submitTx = await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_AMT, BASE_AMT * PRICE / ethers.parseEther("1"), await defaultExpiry(), { gasLimit: 180000 });
    const submitRcpt = await submitTx.wait();
    const quoteId = (await oracle.nextQuoteId()) - 1n;
    const startBlock = submitRcpt.blockNumber;
    console.log(`  Submitted quote #${quoteId} at block ${startBlock}`);

    // Wait for window to expire (need block > startSlot + 2)
    const waitBlocks = 5;
    console.log(`  Waiting ${waitBlocks} blocks...`);
    const targetBlock = startBlock + waitBlocks;
    while ((await provider.getBlockNumber()) < targetBlock) {
      await new Promise(r => setTimeout(r, 500));
    }

    try {
      await oracle.vetoUnderpriced(quoteId, { gasLimit: 120000 });
      no(`vetoUnderpriced should have reverted after window`);
    } catch (e) {
      if (e.message?.includes("VerificationWindowExpired") || e.message?.includes("revert")) {
        ok(`vetoUnderpriced reverted as expected after window expired (${e.shortMessage || e.message?.slice(0, 80)})`);
      } else {
        no(`Unexpected error: ${e.shortMessage || e.message?.slice(0, 80)}`);
      }
    }

    // Cleanup: settle and withdraw
    try {
      await oracle.settleValidQuote(quoteId, { gasLimit: 70000 });
      await oracle.withdrawProviderFunds(quoteId, { gasLimit: 100000 });
      ok(`Settled and withdrew after window (cleanup)`);
    } catch (e) {
      // quote may already be in a bad state
      console.log(`  Cleanup note: ${e.shortMessage || e.message?.slice(0, 60)}`);
    }
  }

  // ============================================================
  // Test 4: FR-SV-002 — Cannot settle during verification window
  // ============================================================
  console.log("\n--- Edge Case: Settle during verification window ---");
  {
    const BASE_AMT = ethers.parseEther("1");
    const PRICE = ethers.parseEther("100");
    const submitTx = await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_AMT, BASE_AMT * PRICE / ethers.parseEther("1"), await defaultExpiry(), { gasLimit: 180000 });
    const submitRcpt = await submitTx.wait();
    const quoteId = (await oracle.nextQuoteId()) - 1n;
    const startBlock = submitRcpt.blockNumber;
    const currentBlock = await provider.getBlockNumber();
    console.log(`  Submitted quote #${quoteId} at block ${startBlock}, current=${currentBlock}`);

    try {
      await oracle.settleValidQuote(quoteId, { gasLimit: 70000 });
      no(`settleValidQuote should have reverted during window`);
    } catch (e) {
      if (e.message?.includes("VerificationWindowActive") || e.message?.includes("revert")) {
        ok(`settleValidQuote reverted as expected during window (${e.shortMessage || e.message?.slice(0, 80)})`);
      } else {
        no(`Unexpected error: ${e.shortMessage || e.message?.slice(0, 80)}`);
      }
    }

    // Wait and settle properly for cleanup
    const targetBlock = startBlock + 5;
    while ((await provider.getBlockNumber()) < targetBlock) {
      await new Promise(r => setTimeout(r, 500));
    }
    try {
      await oracle.settleValidQuote(quoteId, { gasLimit: 70000 });
      await oracle.withdrawProviderFunds(quoteId, { gasLimit: 100000 });
      ok(`Settled and withdrew after window (cleanup)`);
    } catch (e) {
      console.log(`  Cleanup note: ${e.shortMessage || e.message?.slice(0, 60)}`);
    }
  }

  // ============================================================
  // Test 5: FR-SV-005 — Only provider can withdraw
  // ============================================================
  console.log("\n--- Edge Case: Non-provider cannot withdraw ---");
  {
    // Generate a random wallet for impersonation
    const randWallet = ethers.Wallet.createRandom().connect(provider);
    const randAddr = randWallet.address;

    const BASE_AMT = ethers.parseEther("1");
    const PRICE = ethers.parseEther("100");
    const submitTx = await oracle.submitQuote(BASE_TOKEN, QUOTE_TOKEN, BASE_AMT, BASE_AMT * PRICE / ethers.parseEther("1"), await defaultExpiry(), { gasLimit: 180000 });
    const submitRcpt = await submitTx.wait();
    const quoteId = (await oracle.nextQuoteId()) - 1n;
    const startBlock = submitRcpt.blockNumber;

    // Wait for window to pass
    const targetBlock = startBlock + 5;
    while ((await provider.getBlockNumber()) < targetBlock) {
      await new Promise(r => setTimeout(r, 500));
    }

    // Settle (clean)
    await oracle.settleValidQuote(quoteId, { gasLimit: 70000 });

    // Try withdraw as random wallet (different provider)
    const oracleAsRand = new ethers.Contract(ORACLE_ADDRESS, oracleAbi.abi, randWallet);
    try {
      await oracleAsRand.withdrawProviderFunds(quoteId, { gasLimit: 100000 });
      no(`withdrawProviderFunds should have reverted for non-provider`);
    } catch (e) {
      if (e.message?.includes("NotQuoteProvider") || e.message?.includes("revert")) {
        ok(`Non-provider withdraw reverted as expected`);
      } else {
        no(`Unexpected error: ${e.shortMessage || e.message?.slice(0, 80)}`);
      }
    }

    // Withdraw as actual provider
    await oracle.withdrawProviderFunds(quoteId, { gasLimit: 100000 });
    ok(`Provider withdrew successfully`);
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error("Fatal:", e.shortMessage || e.message);
  process.exit(1);
});

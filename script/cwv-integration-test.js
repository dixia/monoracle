import "dotenv/config";
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

const STATUS_NAME = ["ACTIVE", "VETOED_UNDERPRICED", "VETOED_OVERPRICED", "SETTLED_VALID", "SETTLED_WITHDRAWN"];
const BASE_TOKEN = process.env.BASE_TOKEN || "0xAf078b1cAb4797bA018C8354913eaE22f0f1F719";
const QUOTE_TOKEN = process.env.QUOTE_TOKEN || "0x3c34C844EeaeCbc760a74723FC67d8DF49a05093";

let passCount = 0;
let failCount = 0;

function pass(msg) { passCount++; console.log(`  [PASS] ${msg}`); }
function fail(msg) { failCount++; console.log(`  [FAIL] ${msg}`); }

async function ensure(wallet, token, amount, spender) {
  const c = new ethers.Contract(token, ERC20_ABI, wallet);
  const addr = await wallet.getAddress();
  const bal = await c.balanceOf(addr);
  if (bal < amount) {
    console.log(`  Minting ${ethers.formatEther(amount)} more tokens...`);
    await (await c.mint(addr, amount, { gasLimit: 80000 })).wait();
  }
  const allow = await c.allowance(addr, spender);
  if (allow < amount) {
    console.log(`  Approving oracle for tokens...`);
    await (await c.approve(spender, amount, { gasLimit: 80000 })).wait();
  }
}

// Wait until block.number > target (or until target reached).
async function waitForBlock(provider, target, label) {
  let cur = await provider.getBlockNumber();
  if (cur > target) return cur;
  console.log(`  Waiting for block ${target} (current ${cur}) [${label}]...`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    cur = await provider.getBlockNumber();
    if (cur > target) return cur;
  }
}

// Submit with a window of `slots` blocks. Reads a fresh tip, uses a slight
// buffer (heads can lag individual blocks behind the node's head), and retries
// with a fresh tip while the quote was not created (expiry slipped past).
async function submitQuoteWithWindow(provider, oracle, base, quote, bAmt, qAmt, slots) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const nextIdBefore = await oracle.nextQuoteId();
    const tip = await provider.getBlockNumber();
    // Inclusion slack: Monad testnet RPC heads can lag the real chain by a few
    // blocks, so a bare tip+slots can land ON expiry and revert. Add 4 blocks.
    const expiry = tip + slots + 5;
    const sub = await oracle.submitQuote(base, quote, bAmt, qAmt, expiry, { gasLimit: 500000 });
    try {
      const rcpt = await sub.wait();
      return { rcpt, expiry };
    } catch (e) {
      const nextIdAfter = await oracle.nextQuoteId();
      if (nextIdAfter === nextIdBefore) {
        console.log(`    (retry: submit tx not created, attempt ${attempt + 1})`);
        continue;
      }
      throw e;
    }
  }
  throw new Error("submitQuoteWithWindow: 5 attempts, quote not created");
}

// staticCall simulates the tx off-chain: asserts the revert reason without
// broadcasting (and without paying gas / burning a reverted tx on testnet).
async function expectRevert(fn, msg, expectedErr) {
  try {
    await fn();
    fail(`${msg} (expected revert ${expectedErr || "any"})`);
  } catch (e) {
    const reason = [e.shortMessage, e.message, e.revert?.name, e.error?.shortMessage]
      .filter(Boolean).join(" | ");
    if (expectedErr && reason.includes(expectedErr)) {
      pass(msg);
    } else if (expectedErr) {
      fail(`${msg} — reverted with different reason: ${reason}`);
    } else {
      pass(msg);
    }
  }
}

async function main() {
  console.log("=== CWV-01 Live Integration Test (Monad Testnet) ===\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();

  const deployInfo = JSON.parse(fs.readFileSync(path.join(rootDir, "deployment.json"), "utf8"));
  const ORACLE = deployInfo.address;
  console.log(`Wallet:    ${addr}`);
  console.log(`Oracle:    ${ORACLE}`);
  console.log(`Deployed:  ${deployInfo.timestamp}`);
  console.log(`Block:     ${await provider.getBlockNumber()}\n`);

  const oracleAbi = getAbi("Monoracle");
  const oracle = new ethers.Contract(ORACLE, oracleAbi.abi, wallet);

  const MAX = BigInt(await oracle.MAX_VERIFICATION_SLOTS());
  const DEF_SLOTS = BigInt(await oracle.VERIFICATION_SLOTS());
  console.log(`MAX_VERIFICATION_SLOTS = ${MAX}`);
  console.log(`VERIFICATION_SLOTS (default) = ${DEF_SLOTS}\n`);

  // -----------------------------------------------------------
  // 0. Env sanity: constants + default window constant ok
  // -----------------------------------------------------------
  console.log("0. Constants");
  if (MAX === 12000n) pass("MAX_VERIFICATION_SLOTS = 12000");
  else fail(`MAX_VERIFICATION_SLOTS = ${MAX}, expected 12000`);
  if (DEF_SLOTS === 2n) pass("VERIFICATION_SLOTS = 2 (default)");
  else fail(`VERIFICATION_SLOTS = ${DEF_SLOTS}, expected 2`);

  // -----------------------------------------------------------
  // 1. Validity / griefing-cap guards
  // -----------------------------------------------------------
  console.log("\n1. Input guards");
  const cur = await provider.getBlockNumber();
  await ensure(wallet, BASE_TOKEN, ethers.parseEther("2"), ORACLE);
  await ensure(wallet, QUOTE_TOKEN, ethers.parseEther("200"), ORACLE);

  // Capture a fresh tip inside each guard so a block advancing between reads
  // can't silently make the expiry valid.
  await expectRevert(
    async () => {
      const tip = await provider.getBlockNumber();
      return oracle.submitQuote.staticCall(BASE_TOKEN, QUOTE_TOKEN, ethers.parseEther("1"), ethers.parseEther("100"), tip);
    },
    "expiryBlock = current block rejected",
    "ExpiryMustBeFuture"
  );
  await expectRevert(
    async () => {
      // Buffer of +2 so the head advancing one block between the read and the
      // simulated call can't make expiry valid.
      const tip = await provider.getBlockNumber();
      return oracle.submitQuote.staticCall(BASE_TOKEN, QUOTE_TOKEN, ethers.parseEther("1"), ethers.parseEther("100"), tip + Number(MAX) + 100);
    },
    "expiryBlock beyond MAX rejected",
    "ExpiryTooFar"
  );

  // -----------------------------------------------------------
  // 2. Long window: quote remains vetoable well past default 2 slots
  // -----------------------------------------------------------
  console.log("\n2. Configurable long window");
  const LONG = 40; // blocks (~12s) — far beyond the default 2-slot window
  const { rcpt: longRcpt, expiry: expiryLong } = await submitQuoteWithWindow(
    provider, oracle, BASE_TOKEN, QUOTE_TOKEN,
    ethers.parseEther("1"), ethers.parseEther("100"), LONG
  );
  const longId = (await oracle.nextQuoteId()) - 1n;
  const qLong = await oracle.quotes(longId);
  console.log(`  #${longId} submitted at block ${longRcpt.blockNumber}, expiryBlock=${qLong.expiryBlock}`);
  if (Number(qLong.expiryBlock) === expiryLong) pass("expiryBlock stored = requested");
  else fail(`expiryBlock=${qLong.expiryBlock}, expected ${expiryLong}`);
  if (qLong.status === 0n) pass("quote ACTIVE on submit");
  else fail(`status=${STATUS_NAME[Number(qLong.status)]}`);

  // Wait for the quote to be past the default 2-slot window yet still safely
  // inside the long window. We veto EARLY (a handful of blocks after submit)
  // rather than near expiry: Monad testnet RPC heads lag the real chain, and
  // the lag is unpredictable — waiting near expiry risks the tx landing past
  // expiryBlock and reverting. Early veto keeps us far from the edge no matter
  // how far behind the RPC head is.
  const longSubBlock = Number(longRcpt.blockNumber);
  const target = longSubBlock + 8;
  console.log(`  Submitted at block ${longSubBlock}, waiting for block ${target} (current ${await provider.getBlockNumber()})...`);
  await waitForBlock(provider, target, "past default 2-slot window");

  const qLongMid = await oracle.quotes(longId);
  if (qLongMid.status === 0n) pass(`still ACTIVE at block ${await provider.getBlockNumber()} (past default 2 slots, inside long window)`);
  else fail(`quote left ACTIVE too early: ${STATUS_NAME[Number(qLongMid.status)]}`);

  const curBlock = await provider.getBlockNumber();
  console.log(`  Current block ${curBlock}, expiryBlock ${qLong.expiryBlock} (inclusive)`);
  const vetoLong = await oracle.vetoOverpriced(longId, { gasLimit: 300000 });
  const vetoRcpt = await vetoLong.wait();
  const qLongFinal = await oracle.quotes(longId);
  if (vetoRcpt.blockNumber <= Number(qLong.expiryBlock) && qLongFinal.status === 2n)
    pass(`veto inside long window succeeded at block ${vetoRcpt.blockNumber} → VETOED_OVERPRICED`);
  else fail(`veto result: status=${STATUS_NAME[Number(qLongFinal.status)]}`);

  // -----------------------------------------------------------
  // 3. Short (default) window: settle only after window passes
  // -----------------------------------------------------------
  console.log("\n3. Short window: settle only after expiry passes");
  const SHORT = 12; // blocks (~4s) — short but wide enough to survive RPC head lag
  await ensure(wallet, BASE_TOKEN, ethers.parseEther("2"), ORACLE);
  await ensure(wallet, QUOTE_TOKEN, ethers.parseEther("200"), ORACLE);

  const { rcpt: shortRcpt, expiry: expiryShort } = await submitQuoteWithWindow(
    provider, oracle, BASE_TOKEN, QUOTE_TOKEN,
    ethers.parseEther("1"), ethers.parseEther("50"), SHORT
  );
  const shortId = (await oracle.nextQuoteId()) - 1n;
  console.log(`  #${shortId} submitted at block ${shortRcpt.blockNumber}, expiryBlock=${expiryShort}`);

  await expectRevert(
    () => oracle.settleValidQuote.staticCall(shortId),
    "settle inside active window rejected",
    "VerificationWindowActive"
  );

  await waitForBlock(provider, expiryShort, "default 2-slot window");
  await oracle.settleValidQuote(shortId, { gasLimit: 150000 });
  const [price, settledSlot, exists] = await oracle.getLatestPrice(BASE_TOKEN, QUOTE_TOKEN);
  const qShort = await oracle.quotes(shortId);
  if (qShort.status === 3n) pass("quote SETTLED_VALID after window");
  else fail(`status=${STATUS_NAME[Number(qShort.status)]}`);
  if (exists && Number(settledSlot) > 0) pass(`price feed live: ${ethers.formatEther(price)} @ slot ${settledSlot}`);
  else fail("getLatestPrice does not return the settled price");

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch((e) => {
  console.error("CRASH:", e.shortMessage || e.message);
  if (e.info) console.error("  Info:", JSON.stringify(e.info, null, 2));
  if (e.transaction) console.error("  TxData:", e.transaction.data);
  process.exit(1);
});
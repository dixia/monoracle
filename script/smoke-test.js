import { ethers } from "ethers";
import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const ONE_ETH = ethers.parseEther("1");

function getAbi(name) {
  const p = path.join(rootDir, "artifacts", "contracts", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const PRIVATE_KEYS = [
  process.env.HARDHAT_ACCOUNT0 || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  process.env.HARDHAT_ACCOUNT1 || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  process.env.HARDHAT_ACCOUNT2 || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
];

// Tx helper: signs and sends with explicit nonce, waits, increments
async function send(signer, tx, nonceRef) {
  tx.nonce = nonceRef.value++;
  const resp = await signer.sendTransaction(tx);
  return await resp.wait();
}

async function main() {
  console.log("=== Monoracle Smoke Test ===\n");

  const server = await hre.network.createServer("hardhat");
  const addrInfo = await server.listen();
  const rpcUrl = `http://${addrInfo.address}:${addrInfo.port}`;
  console.log(`Node: ${rpcUrl}`);
  await new Promise(r => setTimeout(r, 500));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallets = PRIVATE_KEYS.map(k => new ethers.Wallet(k, provider));
  const [wProvider, wVerifier, wOther] = wallets;

  let pass = 0, fail = 0;
  function check(cond, msg) {
    if (cond) { pass++; console.log(`  [PASS] ${msg}`); }
    else { fail++; console.log(`  [FAIL] ${msg}`); }
  }
  async function checkRevert(promise, msg) {
    try { await promise; fail++; console.log(`  [FAIL] ${msg}`); }
    catch { pass++; console.log(`  [PASS] ${msg}`); }
  }

  try {
    const provAddr = await wProvider.getAddress();
    console.log(`Provider: ${provAddr}`);
    const verifAddr = await wVerifier.getAddress();
    console.log(`Verifier: ${verifAddr}`);

    // Track nonce per signer
    const nonce = { value: Number(await wProvider.getNonce()) };
    const vNonce = { value: Number(await wVerifier.getNonce()) };

    // Deploy BaseToken
    const mockAbi = getAbi("MockERC20");
    const mockBytecode = mockAbi.bytecode;
    const mockIface = new ethers.Interface(mockAbi.abi);

    const deployBase = mockIface.encodeDeploy(["string","string","uint8"], ["Base Token","BASE",18]);
    const baseAddr = ethers.getCreateAddress({ from: provAddr, nonce: nonce.value++ });
    await send(wProvider, { data: ethers.concat([mockBytecode, deployBase]), gasLimit: 2000000 }, nonce);
    const baseToken = new ethers.Contract(baseAddr, mockAbi.abi, wProvider);
    console.log(`BaseToken: ${baseAddr}`);

    // Deploy QuoteToken
    const deployQuote = mockIface.encodeDeploy(["string","string","uint8"], ["Quote Token","QUOTE",18]);
    const quoteAddr = ethers.getCreateAddress({ from: provAddr, nonce: nonce.value++ });
    await send(wProvider, { data: ethers.concat([mockBytecode, deployQuote]), gasLimit: 2000000 }, nonce);
    const quoteToken = new ethers.Contract(quoteAddr, mockAbi.abi, wProvider);
    console.log(`QuoteToken: ${quoteAddr}`);

    // Mint tokens
    await send(wProvider, { to: baseAddr, data: mockIface.encodeFunctionData("mint", [provAddr, ethers.parseEther("10000")]) }, nonce);
    await send(wProvider, { to: quoteAddr, data: mockIface.encodeFunctionData("mint", [provAddr, ethers.parseEther("10000000")]) }, nonce);
    await send(wProvider, { to: baseAddr, data: mockIface.encodeFunctionData("mint", [verifAddr, ethers.parseEther("10000")]) }, nonce);
    await send(wProvider, { to: quoteAddr, data: mockIface.encodeFunctionData("mint", [verifAddr, ethers.parseEther("10000000")]) }, nonce);

    // Deploy Oracle
    const oracleAbi = getAbi("Monoracle");
    const oracleBytecode = oracleAbi.bytecode;
    const oracleIface = new ethers.Interface(oracleAbi.abi);
    const oracleAddr = ethers.getCreateAddress({ from: provAddr, nonce: nonce.value++ });
    await send(wProvider, { data: oracleBytecode, gasLimit: 3000000 }, nonce);
    const oracle = new ethers.Contract(oracleAddr, oracleAbi.abi, wProvider);
    console.log(`Oracle: ${oracleAddr}`);

    // Default 2-slot verification window (inclusive). Computed before the submit
    // tx lands, so tip+3 => startSlot+2.
    const defaultExpiry = async () => (await provider.getBlockNumber()) + 3;

    // --- Tests ---
    check(await oracle.VERIFICATION_SLOTS() === 2n, "VERIFICATION_SLOTS = 2");
    check(await oracle.nextQuoteId() === 1n, "nextQuoteId starts at 1 (0 is sentinel)");

    // Approve & submit quote
    const bAmt = ethers.parseEther("2");
    const price = ethers.parseEther("100");
    const qAmt = bAmt * price / ONE_ETH;

    await send(wProvider, { to: baseAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, bAmt]) }, nonce);
    await send(wProvider, { to: quoteAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, qAmt]) }, nonce);
    const tx = await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", [baseAddr, quoteAddr, bAmt, qAmt, await defaultExpiry()]) }, nonce);
    const qId = new ethers.Interface(["event QuoteSubmitted(uint256 indexed,address,address,address,uint256,uint256,uint256,uint32,uint32)"]).parseLog({ topics: tx.logs[0].topics, data: tx.logs[0].data })?.args[0];
    check(qId === 0n, "Quote submitted, id=0");

    const q = await oracle.quotes(qId);
    check(q.provider === provAddr, "Provider address correct");
    check(q.baseAmount === bAmt, "baseAmount correct");
    check(q.status === 0n, "Status = ACTIVE");
    check(await baseToken.balanceOf(oracleAddr) === bAmt, "Contract holds base");
    check(await quoteToken.balanceOf(oracleAddr) === qAmt, "Contract holds quote");

    // VetoOverpriced
    await send(wVerifier, { to: baseAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, bAmt]) }, vNonce);
    const txVeto = await send(wVerifier, { to: oracleAddr, data: oracleIface.encodeFunctionData("vetoOverpriced", [qId]) }, vNonce);
    check((await oracle.quotes(qId)).status === 2n, "Veto status = VETOED_OVERPRICED");
    check(await baseToken.balanceOf(oracleAddr) === bAmt * 2n, "Contract holds 2x base after veto");
    check(await quoteToken.balanceOf(oracleAddr) === 0n, "Contract holds 0 quote after veto");

    // New quote + settle
    const price2 = ethers.parseEther("500");
    const qAmt2 = bAmt * price2 / ONE_ETH;
    await send(wProvider, { to: baseAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, bAmt]) }, nonce);
    await send(wProvider, { to: quoteAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, qAmt2]) }, nonce);
    const tx2 = await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", [baseAddr, quoteAddr, bAmt, qAmt2, await defaultExpiry()]) }, nonce);
    const qId2 = new ethers.Interface(["event QuoteSubmitted(uint256 indexed,address,address,address,uint256,uint256,uint256,uint32,uint32)"]).parseLog({ topics: tx2.logs[0].topics, data: tx2.logs[0].data })?.args[0];
    check(qId2 === 1n, "Second quote id=1");

    await provider.send("hardhat_mine", ["0x3"]);
    const oNonce = { value: Number(await wOther.getNonce()) };
    await send(wOther, { to: oracleAddr, data: oracleIface.encodeFunctionData("settleValidQuote", [qId2]) }, oNonce);
    check((await oracle.quotes(qId2)).status === 3n, "Settle status = SETTLED_VALID");

    // getLatestPrice
    const [feedPrice, feedSlot, exists] = await oracle.getLatestPrice(baseAddr, quoteAddr);
    check(exists, "Price exists after settlement");
    check(feedPrice === price2, `Price correct: ${ethers.formatEther(feedPrice)}`);
    check(feedSlot !== 0n, "Settled slot > 0");

    // Unknown pair
    const [, , exists2] = await oracle.getLatestPrice(
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002"
    );
    check(!exists2, "Unknown pair returns false");

    // Withdraw from vetoed (2x base)
    const baseBefore = await baseToken.balanceOf(provAddr);
    await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("withdrawProviderFunds", [qId]) }, nonce);
    check(await baseToken.balanceOf(provAddr) - baseBefore === bAmt * 2n, "Withdrew 2x base from vetoed");
    check((await oracle.quotes(qId)).status === 4n, "Vetoed status = SETTLED_WITHDRAWN");

    // Withdraw from valid
    const baseBefore2 = await baseToken.balanceOf(provAddr);
    await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("withdrawProviderFunds", [qId2]) }, nonce);
    check(await baseToken.balanceOf(provAddr) - baseBefore2 === bAmt, "Withdrew collateral from valid");
    check((await oracle.quotes(qId2)).status === 4n, "Valid status = SETTLED_WITHDRAWN");

    // Error cases
    await checkRevert(
      send(wVerifier, { to: oracleAddr, data: oracleIface.encodeFunctionData("withdrawProviderFunds", [qId]) }, vNonce),
      "Non-provider withdraw reverted"
    );
    await checkRevert(
      send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", [baseAddr, quoteAddr, 0, ethers.parseEther("100"), await defaultExpiry()]) }, nonce),
      "Zero baseAmount reverted"
    );
    await checkRevert(
      send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", [baseAddr, baseAddr, bAmt, qAmt, await defaultExpiry()]) }, nonce),
      "Identical tokens reverted"
    );
    await checkRevert(
      send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", ["0x0000000000000000000000000000000000000000", quoteAddr, bAmt, qAmt, await defaultExpiry()]) }, nonce),
      "Address(0) token reverted"
    );

    // 6-decimal tokens
    const deploy6 = mockIface.encodeDeploy(["string","string","uint8"], ["USDC","USDC",6]);
    const usdcAddr = ethers.getCreateAddress({ from: provAddr, nonce: nonce.value++ });
    await send(wProvider, { data: ethers.concat([mockBytecode, deploy6]), gasLimit: 2000000 }, nonce);
    const usdc = new ethers.Contract(usdcAddr, mockAbi.abi, wProvider);
    await send(wProvider, { to: usdcAddr, data: mockIface.encodeFunctionData("mint", [provAddr, 1_000_000_000n]) }, nonce);

    const usdcBAmt = 1_000_000n;
    const usdcPrice = ethers.parseEther("1");
    const usdcQAmt = usdcBAmt * usdcPrice / ONE_ETH;
    check(usdcQAmt === 1_000_000n, "6-dec: quoteAmount correct (1:1)");
    await send(wProvider, { to: usdcAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, usdcBAmt]) }, nonce);
    await send(wProvider, { to: baseAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, usdcQAmt]) }, nonce);
    const tx3 = await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", [usdcAddr, baseAddr, usdcBAmt, usdcQAmt, await defaultExpiry()]) }, nonce);
    console.log(`  [INFO] 6-dec quote submitted`);

    // Independent pairs
    await send(wProvider, { to: baseAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, bAmt]) }, nonce);
    await send(wProvider, { to: quoteAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, qAmt]) }, nonce);
    const tx4a = await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", [baseAddr, quoteAddr, bAmt, qAmt, await defaultExpiry()]) }, nonce);
    await send(wProvider, { to: quoteAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, bAmt]) }, nonce);
    await send(wProvider, { to: baseAddr, data: mockIface.encodeFunctionData("approve", [oracleAddr, bAmt]) }, nonce);
    const tx4b = await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("submitQuote", [quoteAddr, baseAddr, bAmt, qAmt, await defaultExpiry()]) }, nonce);

    // Parse quote IDs from tx4a, tx4b
    const decodeQId = (tx) => {
      const parsed = new ethers.Interface(["event QuoteSubmitted(uint256 indexed)"])
        .parseLog({ topics: tx.logs[0].topics, data: tx.logs[0].data });
      return parsed?.args[0];
    };
    await provider.send("hardhat_mine", ["0x3"]);
    await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("settleValidQuote", [decodeQId(tx4a)]) }, nonce);
    await send(wProvider, { to: oracleAddr, data: oracleIface.encodeFunctionData("settleValidQuote", [decodeQId(tx4b)]) }, nonce);

    const [pBase, , eBase] = await oracle.getLatestPrice(baseAddr, quoteAddr);
    const [pQuote, , eQuote] = await oracle.getLatestPrice(quoteAddr, baseAddr);
    check(eBase && pBase === price, "BASE/QUOTE direction works");
    check(eQuote && pQuote === price, "QUOTE/BASE direction works");

  } finally {
    await server.close();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => { console.error("CRASH:", e.shortMessage || e.message); process.exit(1); });

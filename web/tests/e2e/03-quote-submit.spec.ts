/**
 * Test: Quote Submission
 * Verifies on-chain state of quote creation, struct fields, token balances.
 * Uses viem for transactions; UI coverage is tested in 05-lifecycle.
 *
 * Requirements: FR-QL-001, FR-QL-002, FR-CE-001, FR-CE-002, FR-CE-003
 */
import { test, expect } from "@playwright/test";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ETHEREUM_BRIDGE_SCRIPT } from "../helpers/ethereum-bridge";
import { MONORACLE_ABI, ERC20_ABI } from "../helpers/abis";
import deployed from "../helpers/addresses.json" with { type: "json" };

const ORACLE = deployed.oracle as Address;
const BASE = deployed.baseToken as Address;
const QUOTE = deployed.quoteToken as Address;

const ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const ACCOUNT_0_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const publicClient = createPublicClient({ chain: hardhat, transport: http("http://localhost:8545") });
const walletClient = createWalletClient({ chain: hardhat, transport: http("http://localhost:8545"), account: privateKeyToAccount(ACCOUNT_0_PK) });

async function approveTokens() {
  await walletClient.writeContract({ address: BASE, abi: ERC20_ABI, functionName: "approve", args: [ORACLE, parseEther("1000")] });
  await walletClient.writeContract({ address: QUOTE, abi: ERC20_ABI, functionName: "approve", args: [ORACLE, parseEther("100000")] });
}

test.describe("03 - Quote Submission", () => {
  test("3.1 - Submit quote creates ACTIVE quote on-chain (nextQuoteId increments)", async () => {
    await approveTokens();
    const nextIdBefore = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint;

    const hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("2"), parseEther("200")],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const nextIdAfter = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint;
    expect(nextIdAfter).toBe(nextIdBefore + 1n);
  });

  test("3.2 - Quote struct has correct fields (FR-QL-002)", async () => {
    await approveTokens();
    const hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("3"), parseEther("600")],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const nextId = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint;
    const quoteId = nextId - 1n;

    const q = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "quotes", args: [quoteId],
    }) as readonly unknown[];
    expect((q[0] as string).toLowerCase()).toBe(ACCOUNT_0.toLowerCase()); // provider
    expect((q[1] as string).toLowerCase()).toBe(BASE.toLowerCase()); // baseToken
    expect((q[2] as string).toLowerCase()).toBe(QUOTE.toLowerCase()); // quoteToken
    expect(q[3]).toBe(parseEther("3")); // baseAmount
    expect(q[5]).toBe(parseEther("200")); // price
    expect(q[8]).toBe(0); // status = ACTIVE
  });

  test("3.3 - Provider tokens deducted after submission (FR-CE-001/002)", async () => {
    await approveTokens();
    const balBaseBefore = await publicClient.readContract({
      address: BASE, abi: ERC20_ABI, functionName: "balanceOf", args: [ACCOUNT_0],
    }) as bigint;
    const balQuoteBefore = await publicClient.readContract({
      address: QUOTE, abi: ERC20_ABI, functionName: "balanceOf", args: [ACCOUNT_0],
    }) as bigint;

    const hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("5"), parseEther("400")],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const balBaseAfter = await publicClient.readContract({
      address: BASE, abi: ERC20_ABI, functionName: "balanceOf", args: [ACCOUNT_0],
    }) as bigint;
    const balQuoteAfter = await publicClient.readContract({
      address: QUOTE, abi: ERC20_ABI, functionName: "balanceOf", args: [ACCOUNT_0],
    }) as bigint;

    expect(balBaseAfter).toBe(balBaseBefore - parseEther("5"));
    expect(balQuoteAfter).toBe(balQuoteBefore - parseEther("400")); // 5 * 80
  });

  test("3.4 - price derived correctly from quoteAmount", async () => {
    await approveTokens();
    const hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("2"), parseEther("300")],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const nextId = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint;
    const quoteId = nextId - 1n;

    const q = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "quotes", args: [quoteId],
    }) as readonly unknown[];
    expect(q[3]).toBe(parseEther("2")); // baseAmount
    expect(q[4]).toBe(parseEther("300")); // quoteAmount = 2 * 150
    expect(q[5]).toBe(parseEther("150")); // price
  });
});

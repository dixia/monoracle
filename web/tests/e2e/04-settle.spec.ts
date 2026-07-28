/**
 * Test: Quote Settlement
 * Covers: settleValidQuote, settledSlot, latestValidQuoteId, getLatestPrice
 * Uses viem + mineBlocks to advance past verification window.
 *
 * Requirements: FR-SV-001, FR-SV-002, FR-SV-003, FR-PF-001, FR-PF-002
 */
import { test, expect } from "@playwright/test";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { MONORACLE_ABI, ERC20_ABI } from "../helpers/abis";
import { mineBlocks } from "../helpers/mine";
import deployed from "../helpers/addresses.json" with { type: "json" };

const ORACLE = deployed.oracle as Address;
const BASE = deployed.baseToken as Address;
const QUOTE = deployed.quoteToken as Address;
const ACCOUNT_0_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const publicClient = createPublicClient({ chain: hardhat, transport: http("http://localhost:8545") });
const walletClient = createWalletClient({ chain: hardhat, transport: http("http://localhost:8545"), account: privateKeyToAccount(ACCOUNT_0_PK) });

async function submitAndAdvance(baseAmt: string, quoteAmt: string): Promise<bigint> {
  await walletClient.writeContract({ address: BASE, abi: ERC20_ABI, functionName: "approve", args: [ORACLE, parseEther("1000")] });
  await walletClient.writeContract({ address: QUOTE, abi: ERC20_ABI, functionName: "approve", args: [ORACLE, parseEther("100000")] });
  const hash = await walletClient.writeContract({
    address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
    args: [BASE, QUOTE, parseEther(baseAmt), parseEther(quoteAmt)],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const nextId = await publicClient.readContract({
    address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
  }) as bigint;
  return nextId - 1n;
}

test.describe("04 - Quote Settlement", () => {
  test("4.1 - Settle changes status to SETTLED_VALID after verification window", async () => {
    const quoteId = await submitAndAdvance("2", "100");
    // Advance 2 blank blocks to pass verification window (startSlot + 2)
    await mineBlocks(2);

    await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "settleValidQuote", args: [quoteId],
    });
    const q = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "quotes", args: [quoteId],
    }) as readonly unknown[];
    expect(q[8]).toBe(3); // status = SETTLED_VALID
  });

  test("4.2 - settledSlot recorded after settlement", async () => {
    const quoteId = await submitAndAdvance("1", "50");
    await mineBlocks(2);

    await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "settleValidQuote", args: [quoteId],
    });
    const q = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "quotes", args: [quoteId],
    }) as readonly unknown[];
    expect(q[7]).toBeGreaterThan(0n); // settledSlot
  });

  test("4.3 - getLatestPrice returns correct values after settlement", async () => {
    const quoteId = await submitAndAdvance("3", "77");
    await mineBlocks(2);

    await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "settleValidQuote", args: [quoteId],
    });
    const [price, slot, exists] = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "getLatestPrice", args: [BASE, QUOTE],
    });
    expect(exists).toBe(true);
    expect(price).toBe(parseEther("25.666666666666666666"));
    expect(slot).toBeGreaterThan(0);
  });
});

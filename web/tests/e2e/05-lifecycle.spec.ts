/**
 * Test: Full Lifecycle & Integration
 * Covers: submit → settle → read price, multiple quotes, 6-decimal tokens, UI full flow
 *
 * Requirements: 5.1 Valid Price Flow, FR-PF-002, NFR-COMP-003
 */
import { test, expect } from "@playwright/test";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ETHEREUM_BRIDGE_SCRIPT } from "../helpers/ethereum-bridge";
import { MONORACLE_ABI, ERC20_ABI } from "../helpers/abis";
import { mineBlocks } from "../helpers/mine";
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

test.describe("05 - Full Lifecycle", () => {
  test("5.1 - Full submit → settle → read price flow (happy path)", async () => {
    await approveTokens();
    const hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("5"), parseEther("250")],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const quoteId = (await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint) - 1n;

    let q = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "quotes", args: [quoteId],
    }) as readonly unknown[];
    expect(q[8]).toBe(0); // ACTIVE
    expect(q[5]).toBe(parseEther("50")); // price

    await mineBlocks(2);
    await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "settleValidQuote", args: [quoteId],
    });

    q = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "quotes", args: [quoteId],
    }) as readonly unknown[];
    expect(q[8]).toBe(3); // SETTLED_VALID
    expect(q[7]).toBeGreaterThan(0n); // settledSlot

    const [price, , exists] = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "getLatestPrice", args: [BASE, QUOTE],
    });
    expect(exists).toBe(true);
    expect(price).toBe(parseEther("50"));
  });

  test("5.2 - Multiple quotes for same pair: latest replaces previous (FR-PF-002)", async () => {
    await approveTokens();
    // Quote 1: price 50
    let hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("1"), parseEther("50")],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    let qId = (await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint) - 1n;
    await mineBlocks(2);
    await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "settleValidQuote", args: [qId],
    });

    // Quote 2: price 200
    hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("1"), parseEther("200")],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    qId = (await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint) - 1n;
    await mineBlocks(2);
    await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "settleValidQuote", args: [qId],
    });

    const [price, , exists] = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "getLatestPrice", args: [BASE, QUOTE],
    });
    expect(exists).toBe(true);
    expect(price).toBe(parseEther("200"));
  });

  test("5.3 - 6-decimal tokens (USDC-like) work correctly (NFR-COMP-003)", async () => {
    const { default: fs } = await import("fs");
    const { default: path } = await import("path");
    const artifact = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname!, "..", "..", "..", "artifacts", "contracts", "MockERC20.sol", "MockERC20.json"),
        "utf8"
      )
    );

    const usdcHash = await walletClient.deployContract({
      abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: ["USD Coin", "USDC", 6],
    });
    const usdc = (await publicClient.waitForTransactionReceipt({ hash: usdcHash })).contractAddress!;
    const usdtHash = await walletClient.deployContract({
      abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: ["Tether USD", "USDT", 6],
    });
    const usdt = (await publicClient.waitForTransactionReceipt({ hash: usdtHash })).contractAddress!;

    await walletClient.writeContract({ address: usdc, abi: ERC20_ABI, functionName: "mint", args: [ACCOUNT_0, 1_000_000_000n] });
    await walletClient.writeContract({ address: usdt, abi: ERC20_ABI, functionName: "mint", args: [ACCOUNT_0, 1_000_000_000n] });
    await walletClient.writeContract({ address: usdc, abi: ERC20_ABI, functionName: "approve", args: [ORACLE, 1_000_000_000n] });
    await walletClient.writeContract({ address: usdt, abi: ERC20_ABI, functionName: "approve", args: [ORACLE, 1_000_000_000n] });

    const bAmt = 1_000_000n;
    const quoteAmt = bAmt * parseEther("1") / 10n**18n;
    const hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [usdc, usdt, bAmt, quoteAmt],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const qId = (await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint) - 1n;

    const q = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "quotes", args: [qId],
    }) as readonly unknown[];
    expect(q[3]).toBe(bAmt); // baseAmount
    expect(q[4]).toBe(1_000_000n); // quoteAmount
    expect(q[5]).toBe(parseEther("1")); // price
  });

  test("5.4 - UI reads settled price after viem submit+settle", async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await expect(page.getByText(/0xf39F.*2266/)).toBeVisible({ timeout: 10000 });

    // Submit + settle via viem
    await approveTokens();
    const hash = await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "submitQuote",
      args: [BASE, QUOTE, parseEther("3"), parseEther("900")],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const qId = (await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "nextQuoteId",
    }) as bigint) - 1n;

    await mineBlocks(2);
    await walletClient.writeContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "settleValidQuote", args: [qId],
    });

    // Wait for initial load to complete (either "No price data" or price data)
    await expect(page.getByRole("button", { name: "Query" })).toBeEnabled({ timeout: 15000 });
    // Refetch via UI to get the latest settled price
    await page.getByRole("button", { name: "Query" }).click();
    // After settlement, the price section should show settled data
    await expect(page.getByText("Settled At Block")).toBeVisible({ timeout: 20000 });
  });
});

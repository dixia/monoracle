/**
 * Test: Price Reader (PriceReader component)
 * Covers: getLatestPrice, preset pairs, unknown pairs
 *
 * Requirements: FR-PF-001, FR-PF-002, FR-PF-003
 */
import { test, expect } from "@playwright/test";
import { createPublicClient, http, type Address } from "viem";
import { hardhat } from "viem/chains";
import { ETHEREUM_BRIDGE_SCRIPT } from "../helpers/ethereum-bridge";
import { MONORACLE_ABI } from "../helpers/abis";
import deployed from "../helpers/addresses.json" with { type: "json" };

const publicClient = createPublicClient({ chain: hardhat, transport: http("http://localhost:8545") });
const ORACLE = deployed.oracle as Address;
const BASE = deployed.baseToken as Address;
const QUOTE = deployed.quoteToken as Address;

test.describe("02 - Price Reader", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");
  });

  test("2.1 - Query BASE/QUOTE pair: no price registered yet", async () => {
    const [, , exists] = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "getLatestPrice",
      args: [BASE, QUOTE],
    });
    expect(exists).toBe(false);
  });

  test("2.2 - Query unknown pair returns exists=false via contract", async () => {
    const addr = "0x0000000000000000000000000000000000000001" as Address;
    const [, , exists] = await publicClient.readContract({
      address: ORACLE, abi: MONORACLE_ABI, functionName: "getLatestPrice",
      args: [addr, addr],
    });
    expect(exists).toBe(false);
  });

  test("2.3 - Custom token address input fields accept user input", async ({ page }) => {
    const baseInput = page.getByPlaceholder("Base token address");
    const quoteInput = page.getByPlaceholder("Quote token address");
    await baseInput.fill("0x1111111111111111111111111111111111111111");
    await quoteInput.fill("0x2222222222222222222222222222222222222222");
    await expect(baseInput).toHaveValue("0x1111111111111111111111111111111111111111");
    await expect(quoteInput).toHaveValue("0x2222222222222222222222222222222222222222");
  });

  test("2.4 - Price section rendered and 'Query' button functional", async ({ page }) => {
    await expect(page.getByText("Read Latest Price")).toBeVisible();
    await expect(page.getByRole("button", { name: "Query" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Query" })).toBeEnabled();
  });

  test("2.5 - BASE/QUOTE fields pre-filled with deployed token addresses", async ({ page }) => {
    await expect(page.getByPlaceholder("Base token address")).toHaveValue(BASE);
    await expect(page.getByPlaceholder("Quote token address")).toHaveValue(QUOTE);
  });
});

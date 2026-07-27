/**
 * Test: Wallet Connection (Header component)
 * Covers: Connect Wallet, Disconnect, address display, wallet-gated UI sections
 *
 * On-chain verification: none (pure UI state)
 */
import { test, expect } from "@playwright/test";
import { ETHEREUM_BRIDGE_SCRIPT } from "../helpers/ethereum-bridge";

test.describe("01 - Wallet Connection", () => {
  test("1.1 - 'Connect Wallet' button visible when disconnected", async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");

    const connectBtn = page.getByRole("button", { name: "Connect Wallet" });
    await expect(connectBtn).toBeVisible();
  });

  test("1.2 - Clicking 'Connect Wallet' injects Hardhat Account #0", async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");

    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const addressText = page.getByText(/0xf39F.*2266/);
    await expect(addressText).toBeVisible({ timeout: 10000 });
  });

  test("1.3 - Connected state shows truncated address + 'Disconnect' button", async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");

    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await expect(page.getByText(/0xf39F.*2266/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  test("1.4 - 'Disconnect' returns to initial 'Connect Wallet' state", async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");

    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
  });

  test("1.5 - QuoteSubmit section hidden when not connected", async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");

    const section = page.getByText("Connect your wallet to submit a price quotation.");
    await expect(section).toBeVisible();
  });

  test("1.6 - QuoteSubmit form appears after connecting", async ({ page }) => {
    await page.addInitScript(ETHEREUM_BRIDGE_SCRIPT);
    await page.goto("/");

    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await expect(page.getByText(/0xf39F.*2266/)).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Submit a Quote")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Quote" })).toBeVisible();
  });
});

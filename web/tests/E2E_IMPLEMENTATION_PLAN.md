# Monoracle Frontend E2E Test — Implementation Plan

## Architecture Decision

The frontend uses wagmi v3 `injected()` connector which reads `window.ethereum`. We cannot use wagmi's mock connector because it forwards transactions to the chain's RPC, and the Monad testnet public RPC doesn't sign transactions for us.

**Solution**: Run a local Hardhat node (which signs transactions using its unlocked accounts), inject a `window.ethereum` polyfill via Playwright `addInitScript()` that proxies all JSON-RPC calls to the local Hardhat node.

```
┌──────────────────────────────┐
│  Playwright (Chromium)       │
│  ┌────────────────────────┐  │
│  │  Next.js Frontend      │  │
│  │  wagmi injected() ───► │  │  addInitScript() injects
│  │  window.ethereum ────► │  │  window.ethereum = {
│  │                        │  │    request: fetch(localhost:8545)
│  │                        │  │  }
│  └────────────────────────┘  │
└──────────────────────────────┘
              │
              ▼ fetch JSON-RPC
┌──────────────────────────────┐
│  Hardhat Node (localhost:8545)│
│  - Account #0: 0xf39Fd6e...  │
│  - Account #1: 0x7099797...  │
│  - Deployed: Monoracle        │
│  - Deployed: MockERC20 x2     │
└──────────────────────────────┘
```

## Test Coverage (24 scenarios)

| # | Test | Requirement | Component |
|---|------|-------------|-----------|
| **01-wallet.spec.ts** | | | |
| 1 | "Connect Wallet" button visible when disconnected | — | Header |
| 2 | Clicking "Connect Wallet" connects successfully | — | Header |
| 3 | Connected state shows address + "Disconnect" button | — | Header |
| 4 | Disconnect returns to "Connect Wallet" state | — | Header |
| 5 | QuoteSubmit hidden when not connected | — | QuoteSubmit |
| **02-price-reader.spec.ts** | | | |
| 6 | Query unknown pair → returns `exists=false` | FR-PF-001 | PriceReader |
| 7 | Query preset BASE/QUOTE pair (initially no price) | FR-PF-001 | PriceReader |
| 8 | Switch between all preset pairs | FR-PF-001 | PriceReader |
| 9 | Custom token address input works | FR-PF-001 | PriceReader |
| **03-quote-submit.spec.ts** | | | |
| 10 | Submit with valid inputs → tx succeeds | FR-QL-005, FR-CE-002 | QuoteSubmit |
| 11 | Quote created as ACTIVE with correct fields | FR-QL-001/002 | QuoteSubmit |
| 12 | Approval flow triggers when allowance insufficient | FR-CE-003 | QuoteSubmit |
| 13 | `baseAmount=0` → error | FR-QL-001 | QuoteSubmit |
| 14 | `price=0` (quoteAmount=0) → error | FR-QL-001 | QuoteSubmit |
| 15 | Identical tokens → error | FR-QL-001 | QuoteSubmit |
| 16 | Contract holds tokens post-submit | FR-CE-001/002 | QuoteSubmit |
| 17 | Settle button appears after successful submit | FR-SV-001 | SettleButton |
| **04-settle.spec.ts** | | | |
| 18 | Settle after window → status=SETTLED_VALID | FR-SV-001/003 | SettleButton |
| 19 | `settledSlot` recorded after settlement | FR-SV-003 | SettleButton |
| 20 | `latestValidQuoteId` updated | FR-PF-002 | SettleButton |
| 21 | `getLatestPrice` returns new price post-settle | FR-PF-001 | PriceReader |
| **05-lifecycle.spec.ts** | | | |
| 22 | Full flow: Submit → Wait 3 blocks → Settle → Read | §5.1 | All |
| 23 | Two quotes for same pair, latest replaces previous | FR-PF-002 | All |
| 24 | 6-decimal tokens (USDC-like) query works | NFR-COMP-003 | PriceReader |

## Implementation Steps

### Step 1: Modify `web/src/lib/wagmi.ts` — Add env var for RPC URL

Add `NEXT_PUBLIC_RPC_URL` support so tests can point to `http://localhost:8545`.

### Step 2: Modify `web/src/lib/oracle.ts` — Add env var for contract addresses

Add `NEXT_PUBLIC_ORACLE_ADDRESS`, `NEXT_PUBLIC_BASE_TOKEN`, `NEXT_PUBLIC_QUOTE_TOKEN`.

### Step 3: Create `web/tests/helpers/deploy.ts` — Deploy contracts to Hardhat

Uses viem to deploy Monoracle.sol + 2 MockERC20 tokens to a running Hardhat node.
Exports: `deployContracts()` which returns `{ oracle, baseToken, quoteToken }`.

### Step 4: Create `web/tests/setup.ts` — Playwright globalSetup

1. Start Hardhat node as child process (`npx hardhat node`)
2. Wait for node to be ready
3. Call `deployContracts()` to deploy everything
4. Write `.env.test` file with env vars
5. Return the process handle for teardown

### Step 5: Create `web/tests/helpers/ethereum-bridge.ts` — window.ethereum polyfill

A JavaScript string that creates a `window.ethereum` object proxying to `http://localhost:8545`.
Injected via `page.addInitScript()` before each test.

### Step 6: Create `web/playwright.config.ts`

Configures Playwright with:
- testDir: `./tests`
- webServer: `npx next dev` on port 3000
- globalSetup: `./tests/setup.ts`
- workers: 1 (sequential, avoid nonce issues)
- timeout: 30s per test

### Step 7: Install dependencies

```bash
cd web
npm install --save-dev @playwright/test viem
npx playwright install chromium
```

### Step 8: Update `web/package.json` scripts

```json
"test:e2e": "playwright test",
"test:setup": "npx hardhat node & sleep 2 && node tests/helpers/deploy.ts"
```

### Step 9-13: Write the 5 test spec files

Each test file follows this structure:
1. `test.beforeEach` — navigate to page, inject ethereum bridge, connect wallet
2. `test` — perform UI actions, wait, assert UI + on-chain state
3. Use `viem` PublicClient to directly verify contract state after each action

### Test Structure Pattern

```typescript
import { test, expect } from "@playwright/test";
import { createPublicClient, http } from "viem";
import { hardhat } from "viem/chains";
import { ethereumBridgeScript } from "../helpers/ethereum-bridge";
import { ORACLE_ABI } from "../helpers/abis";

const publicClient = createPublicClient({
  chain: hardhat,
  transport: http(),
});

test.describe("Wallet", () => {
  test("connect wallet button visible on load", async ({ page }) => {
    await page.addInitScript(ethereumBridgeScript);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
  });
  
  test("connect wallet works", async ({ page }) => {
    await page.addInitScript(ethereumBridgeScript);
    await page.goto("/");
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    // Hardhat Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    await expect(page.getByText("0xf39F...2266")).toBeVisible({ timeout: 5000 });
  });
  // ... more tests
});
```

### Key Notes

1. Hardhat Account #0 address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
2. Hardhat Account #1 address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
3. The injected() connector will use account #0 as the connected wallet
4. Hardhat auto-mines blocks instantly, so verification window is immediate
5. The env file `.env.test` is auto-generated by setup and should be gitignored
6. All tests use `workers: 1` to avoid nonce conflicts

### Verification Strategy

After every UI action that writes to the chain:
1. **UI check**: Assert button text, status messages, tx links
2. **On-chain check**: Use `publicClient` to read contract state and assert values

Example:
```typescript
// After submitQuote UI action:
const quoteId = await publicClient.readContract({
  address: oracleAddr,
  abi: ORACLE_ABI,
  functionName: "nextQuoteId",
});
expect(quoteId).toBeGreaterThan(0n);

const quote = await publicClient.readContract({
  address: oracleAddr,
  abi: ORACLE_ABI,
  functionName: "quotes",
  args: [quoteId - 1n],
});
expect(quote.status).toBe(0); // ACTIVE
```

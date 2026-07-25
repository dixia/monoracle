# Monoracle

**Monad Blitz@武汉 — Submission**

## One-Liner

A fully permissionless, game-theoretic on-chain price oracle on Monad — no validators, no off-chain data feeds, just economic incentives and on-chain arbitrage.

## Problem

Existing on-chain oracles (Chainlink, Pyth) rely on off-chain relayers, staked validator sets, or trusted hardware. This creates:
- **Centralization risk** — a handful of nodes control price feeds
- **Liveness dependency** — if relayers go down, prices freeze
- **Latency overhead** — data must travel off-chain → on-chain

## Solution

Monoracle is a **self-correcting oracle** where every price quote is backed by bilateral collateral locked in an on-chain staking contract. During a 2-block verification window, any market participant can profitably veto an incorrect price by arbitraging against the locked collateral. Quotes that survive the window are confirmed as valid canonical prices.

### How It Works

1. **Submit** — A provider deposits base + quote token collateral and states a price (e.g. `MON/USDC = 100`)
2. **Verify** — For 2 blocks, anyone can inspect the quote
3. **Veto (if wrong)** — If the quote is off-market, a verifier arbitrages against the collateral:
   - **Underpriced quote** → Verifier pays quote tokens, receives underpriced base tokens, sells them on secondary market for profit
   - **Overpriced quote** → Verifier pays base tokens, receives overpriced quote tokens, profits from the spread
4. **Settle** — If no veto occurs, the price is canonical and providers withdraw collateral + fees

Price accuracy is guaranteed by **profitable arbitrage**, not by trust.

## Why Monad

- **400ms block time + 800ms finality** — enables the 2-block verification window to resolve in under 1 second
- **Parallel execution** — multiple quotes, vetoes, and settlements can be processed simultaneously without contention
- **128kb contract size limit** — allows all oracle logic in a single immutable contract
- **`eth_sendRawTransactionSync`** — verifiers can submit veto transactions and know the result in the same block, critical for arbitrage profitability

## Tech Stack

- **Solidity ^0.8.20** — Smart contract (ReentrancyGuard, custom access control)
- **Hardhat** — Development, testing, deployment
- **Next.js** — Frontend dashboard
- **Monad Testnet** — Deployment target

## Links

- GitHub: https://github.com/your-org/monoracle
- Contract (Monad Testnet): *deploying...*
- Demo: http://localhost:3000

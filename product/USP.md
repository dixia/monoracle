# Monoracle: Time-Configurable Oracle

**Monoracle is the first time-configurable decentralized oracle.** Unlike traditional oracles (Chainlink, Pyth, etc.) that provide a price update at variable intervals, Monoracle lets you specify exactly when a price should be finalized — in block time.

## Core USP

> Other oracles answer: "What is the price of X right now?"
> Monoracle answers: "What was the price of X between block N and block N+K?"

### Why This Matters

- **Prediction markets**: "Will ETH be above $5,000 at block 48,000,000?" — Monoracle can settle exactly at that block, not at an oracle's next update.
- **Short-term derivatives**: 25-minute, 1-hour, or 100-block price expiry contracts. The oracle window IS the contract expiry.
- **Arbitrage-proof settlement**: At expiry, a short Monoracle window (e.g., 2 blocks) opens. Any mispricing in the settlement quote can be vetoed by permissionless arbitrageurs.
- **No oracle dependency cascade**: Monoracle settles its own markets — no Chainlink, no UMA, no external data feed.

## Configurable Parameters

| Parameter | Current | Planned Range |
|---|---|---|
| Verification window | 2 blocks (600ms) | 2 to ~12,000 blocks (100ms to ~1 hour) |
| Settlement window | N/A (implied by verification window) | Same as verification window |
| Collateral ratio | 1:1 (symmetric) | 1:1 to 1:100 (asymmetric, writer-chosen) |

## Target Use Cases

| Use Case | Window | Example |
|---|---|---|
| Real-time price feed | 2 blocks (600ms) | DeFi lending, DEX internal pricing |
| Short-term binary options | 1,000 blocks (5 min) | "BTC above $105k at market open" |
| Hourly prediction markets | 12,000 blocks (1 hour) | Polymarket-style, Monad-native |
| Scheduled settlements | N blocks (configurable) | Options expiry, futures settlement |

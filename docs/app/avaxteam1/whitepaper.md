# Monoracle + Irrational Market — Whitepaper (Draft)

## Abstract

**Monoracle** is a fully permissionless, game-theoretic on-chain price oracle. Every price
quote is backed by bilateral collateral locked in an immutable contract; during a short,
configurable verification window, any participant can veto a mispriced quote by arbitraging
against that collateral. Quotes that survive become canonical prices with a **guaranteed time
settlement point**. There are no validators, no off-chain data feeds, and no owner.

**Irrational Market (IRMarket)** is the first application built on Monoracle: a permissionless
options market where anyone can long or short any priced asset — including assets that cannot be
shorted elsewhere. It proves the oracle in a real scenario: an option's expiry *is* Monoracle's
veto window.

## 1. The Problem

Existing on-chain oracles (Chainlink, Pyth) depend on off-chain relayers, staked validator sets,
or trusted hardware. This introduces three weaknesses:

1. **Latency** — a price is only as fresh as the last off-chain update. Protocols operating at
   block speed (proportional AMMs, on-chain market makers, arbitrage bots) lose money to stale
   prices.
2. **Centralization / liveness risk** — a price feed can be censored, delayed, or gamed at its
   relay or validator layer.
3. **No temporal finality** — a conventional oracle answers "what is the price right now?" with
   no promise about *when* the price became binding, or how long it can still be disputed.

## 2. Monoracle: A Price Oracle With a Time Expiry

Monoracle's core insight is that a price is only useful if you know **when it became canonical**.
It does not stream a continuous price; it produces discrete settlement events, each with a
block-level expiry.

### 2.1 Lifecycle

1. **Submit** — a provider deposits base + quote token collateral and thereby states a price
   (`price = quoteAmount / baseAmount`).
2. **Verify** — a short verification window opens (default 2 blocks; configurable per chain).
3. **Veto** — if the quoted price is off-market, any permissionless verifier arbitrages the
   collateral for profit:
   - *Underpriced* → the verifier pays the quote side and takes the base side.
   - *Overpriced* → the verifier pays the base side and takes the quote side.
4. **Settle** — if no veto occurs, the price becomes canonical. `getLatestPrice` returns
   `(price, settledSlot, exists)` — a price plus the exact block at which it settled.
5. **Withdraw** — providers reclaim collateral after settlement or veto.

### 2.2 Economic Security

There is no validator set to trust. Price accuracy is enforced purely by game theory: a
misquoter is punished because a verifier can confiscate their mispriced collateral and arbitrage
it against the wider market. The oracle is honest **because honesty is the dominant strategy** —
surviving quotes are exactly those that no participant found profitable to dispute.

The mechanism is **AI-agent native**. Because the veto logic is a pure on-chain game, agents can
continuously optimize arbitrage strategies, profit from corrections, and collectively sharpen
price accuracy over time. A flash-loan veto path (`FLB-01`) lets verifiers police the oracle with
**zero idle capital**, collapsing veto + arbitrage + repayment into one atomic transaction.

### 2.3 Properties

- **Permissionless** — anyone can quote, veto, or consume; no whitelist, no approval.
- **Immutable** — no upgrade mechanism, no owner, no admin.
- **Temporal finality** — every canonical price carries a settlement block.
- **Verifiable** — full quote history is permanently queryable on-chain.

## 3. Irrational Market: The First Application

IRMarket is a permissionless options market on Monoracle. Its reference/settlement price is
always a Monoracle canonical price, enforced by bilateral collateral and permissionless
veto-arbitrage.

- **Short anything** — A-shares, H-shares, Labubu, any priced asset. If it has a price, a market
  can be opened.
- **Call / put, long / short** — users pick a direction, deposit the quote token, and receive
  position units.
- **Max loss = principal** — no liquidation, no margin calls. Payout is a linear spread PNL
  (call: `(settle − open) × units`, put inverted), capped at principal.
- **Low barrier** — traditional options require tens of thousands of RMB per contract; IRMarket
  drops the minimum to cents.
- **Expiry = veto window** — the option settles at exactly the point where the oracle's price
  becomes canonical.

**Why it matters:** a long-only market punishes rationality. When a bubble forms, bears can only
watch. Shorting is the core of price discovery — it gives rational participants a mechanism to act
on their judgment. IRMarket demonstrates Monoracle's primitive in a real, consumer-facing scenario
while proving demand for permissionless derivatives.

## 4. Avalanche Deployment

Monoracle and IRMarket port directly to Avalanche C-Chain (Solidity ^0.8.20, Coreth EVM
compatibility). Three Avalanche-native properties shape the port:

- **~1s block time, sub-second finality (Snowman)** — shortens the veto window and removes the
  reorg-safety margin (finality is probabilistic, but accepted blocks are irreversible in
  practice with no reorg window).
- **Warp + Teleporter** — publish Monoracle's BLS-attested canonical settlement to any subnet via
  `getVerifiedWarpBlockHash` (ACP-30) with Teleporter as the relay layer; candidate import path is
  ACP-108 EVM Event Importing.
- **Anti-MEV mempool design** — Avalanche runs a public mempool with priority-fee ordering and no
  native encrypted mempool on mainnet today. The quote/veto flow must be hardened with
  commit-reveal submission and single-block-atomic veto settlement (see §5.1).

## 5. Work Items

### 5.1 Oracle analytics & cross-protocol divergence dashboard

A public dashboard that monitors the oracle's health and its position within the Avalanche
ecosystem:

- **On-chain price fluctuation** — per-pair price movement over time, straight from settlement
  events.
- **On-chain volatility** — realized volatility computed from Monoracle settlement history;
  leverages millisecond block timestamps (ACP-226) once precision is validated.
- **Price divergence vs Avalanche protocols** — continuously compare Monoracle's canonical price
  against the mark prices of Avalanche perp/derivatives venues (e.g. TraderJoe PerpDex, GMX).
  Divergence spikes flag mispricing, arbitrage opportunities, and oracle health.

This dashboard doubles as both a self-audit tool for the oracle and the reference frontend for
prospective integrators.

### 5.2 Cross-chain settlement publication

A settlement registry that lets any Avalanche subnet import a veto-verified price without
re-solving the game (Warp block-hash attestation + Teleporter relay + ACP-108 import).

## 6. Go-To-Market

**First attempt — IRMarket.** A consumer-facing options market that exercises the oracle in a
real scenario (option expiry = veto window) and validates demand for permissionless shorting.

**Then — the propMM-optimised oracle.** The most time-sensitive users are on-chain: proportional
AMMs (PropAMMs), on-chain market-making programs, and arbitrage bots operate at sub-block speed
and cannot wait for off-chain relayers. Monoracle's sub-second canonical price — a price with a
time settlement point — is the oracle primitive these systems need to price swaps, quotes, and
executions fairly at block speed.

**And — AI-agent-native DeFi.** Because enforcement is a pure on-chain game, agent-run
arbitrageurs, market makers, and flash-loan verifiers become the oracle's own maintenance layer:
they profit from corrections, and their profit motive is what keeps the price honest.

## 7. Summary

Monoracle turns price discovery into a permissionless on-chain game with temporal finality, and
IRMarket is its proof-of-demand. On Avalanche, the combination of fast finality, cross-chain
Warp attestation, and a hardened mempool strategy lets a single canonical price serve both a
consumer options market and the block-speed market-making protocols that need it most.

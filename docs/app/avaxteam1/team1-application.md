# Avalanche Team1 Mini Grants — Application

## Project Name

Monoracle + Irrational Market

## One-liner

A fully permissionless, game-theoretic on-chain price oracle with built-in time settlement — plus a permissionless options market that proves it works.

## Project Description

**Monoracle** is a fully permissionless, game-theoretic on-chain price oracle. Every price quote is backed by bilateral collateral; during a configurable verification window, anyone can veto a mispriced quote via on-chain arbitrage — surviving quotes become canonical prices with a guaranteed time settlement point. No validators, no off-chain feeds.

**Irrational Market (IRMarket)** is the first GTM app built on Monoracle: a permissionless options market where anyone can long or short any priced asset (stocks, collectibles, anything with a price). Every trade is a Monoracle veto — the options expiry equals the veto window, proving the oracle works in a real scenario. Max loss = principal, no liquidation, no margin calls.

## Delivered

**1.A** **Monoracle core** — permissionless game-theoretic oracle primitive: every quote backed by bilateral collateral, configurable verification window, on-chain arbitrage veto for mispriced quotes, canonical price with a guaranteed time settlement point; no validators, no off-chain feeds.

**1.B** **Test coverage** — 106 Hardhat tests + 12 Foundry deterministic boundary tests + 11/11 live integration tests green.

**2.A** **IRMarket** — permissionless options market built on Monoracle: long or short any priced asset, option expiry = the veto window, max loss = principal, no liquidation, no margin calls.

**2.B** **IRMarket infra** — live demo at irmarket.xyz; market-maker bot with auto-restock and round-rolling; factory + 1% fee wrapper deployed and verified; two complete end-to-end flows running (oracle lifecycle + trade lifecycle).

**3.A** **EVM portability** — Solidity ^0.8.20 contracts port directly to Avalanche C-Chain via Coreth; no rewrite needed.

## Potential Technical Research

### High priority

**4.A** **Warp + Teleporter cross-chain settlement publication** — Use Warp Messaging + Warp Block Hash (`getVerifiedWarpBlockHash`, ACP-30, activated) to publish Monoracle's BLS-attested canonical settlement to any Avalanche subnet; Teleporter (live on C-Chain and L1s) as the relay layer. Research: a portable settlement event schema and the import flow that lets any subnet read a veto-verified price without re-solving the game.

**4.B** **Millisecond block timestamps (ACP-226, activated)** — `block.timestamp` at millisecond precision sharpens Monoracle's time-settlement point and IRMarket option expiry; if precision is sufficient, it underwrites later volatility computation. Research: verify ms precision adequacy for volatility inputs.

**4.C** **Anti-MEV mempool design for the veto game** — Avalanche C-Chain runs a public mempool with priority-fee ordering and ~1s blocks; there is no native encrypted mempool or OFA on mainnet today (encrypted mempools are a future ACP-194 feature). Monoracle's quote/veto flow is inherently MEV-exposed: a quote reveals price intent before the verification window closes, and a veto (arbitrage on a mispriced quote) can be front-run or sandwiched. Research: a mempool-safe design — commit-reveal quote submission so price intent does not leak, veto scheduling hardened against ordering manipulation, and leveraging single-block finality so a veto arbitrage settles atomically within one block.

### Forward-compatibility (unimplemented ACPs)

**5.A** **ACP-108 EVM Event Importing (proposed)** — standard `importEvent` interface + Merkle-proof verification against authenticated block hashes; candidate import path for settled-price events onto subnets. Enabler for **4.A**.

**5.B** **ACP-194 Continuous Execution (implementable; Fuji pre-release only)** — research a per-market isolated storage layout so concurrent quote/veto across different markets avoids write conflicts when parallel execution ships; no mainnet dependency.

### Verified

**6.A** **Snowman finality** — accepted blocks are final and irreversible in practice with single-block finality and no reorg window; the underlying guarantee is probabilistic safety, not an absolute "never reorgs" property. Frames veto-window sizing with no reorg-safety margin.

### Optional

**7.A** **secp256r1 precompile** (`0x0100…0100`) — native P-256 signature verification at ~6,900 gas (EIP-7951, activated) enables WebAuthn/passkey login for the IRMarket UI.

**7.B** **Fee economics** — C-Chain base fee can approach 1 wei at low load; ACP-176 keeps large transactions bidable up to ~12.8M gas (big option settlements); under Helicon, gas charged = `max(gasUsed, gasLimit/2)` — motivates tight gas estimation.

## Team

Solo founder (Kurt). AI-first development workflow — requirement harvesting, code review, docs, tests, and deploys all agent-maintained.

## Links

- Monoracle: https://github.com/dixia/monoracle
- IRMarket: https://github.com/dixia/IRMarket · https://irmarket.xyz

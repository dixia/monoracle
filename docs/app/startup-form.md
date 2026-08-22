# Monoracle — DeltaV Startup Form

> Saved snapshot of the DeltaV startup profile (https://deltav.monad.xyz/startup-form).
> Keep updated via browser as the project evolves. This file is gitignored.
> See `docs/workflow.md` for how to update it with Edge.

## Basics

- **Project Name:** Monoracle
- **City:** Wuhan
- **One-sentence description:** A fully permissionless, game-theoretic on-chain price oracle on Monad — price accuracy enforced by economic incentives and on-chain arbitrage, with no validators and no off-chain data feeds.
- **What your company is going to make:** A self-correcting, rate-limited oracle protocol where every price quote is backed by bilateral collateral locked in an on-chain staking contract. During a 2-block (~600ms) verification window, anyone can profitably veto a mispriced quote by arbitraging against the locked collateral; quotes that survive become canonical prices. Native for AI agents to run optimized arbitrage bots, plus a Python veto bot and a Next.js dashboard. Plus a GTM dapp attempt: IRMarket (irmarket.xyz), a permissionless options market built on the Monoracle primitive — designed to test the oracle in a real scenario (option expiry == veto window) while validating demand.
- **Since when working on this:** 2026-07
- **Who invited you:** (blank)
- **Company Logo:** (not uploaded)
- **Banner Image:** (not uploaded)

## Idea

- **Why did you pick this idea?** Existing oracles (Chainlink, Pyth) rely on off-chain relayers, staked validators, or trusted hardware — adding latency, centralization risk, and liveness dependency. PropAMMs, on-chain market makers, and arbitrage bots operate at sub-second speed and need a canonical price resolved within a block or two. Monad's 300ms blocks and 600ms finality make a purely on-chain, game-theoretic price game practical for the first time. Built the Monoracle contract at Monad Blitz@Wuhan (1st place).
- **Vertical experience:** Yes — complete working prototype: Solidity ^0.8.20 contract with full submit/veto/settle/withdraw lifecycle, Python verifier bot (WebSocket + auto-veto), Next.js dashboard, Hardhat tests, deployed and Sourcify-verified on Monad testnet. Won 1st at Monad Blitz@Wuhan.
- **Unique insight:** A price quote is an options-style binary contract: the provider writes it, and any verifier can exercise it (veto) by arbitraging the locked bilateral collateral within a short window. This makes oracle accuracy a permissionless, self-correcting game enforced by profitable arbitrage — and it's AI-agent native. The primitive extends into options, prediction markets, and derivatives settlement.

## Problem & Solution

- **Problem:** Existing on-chain oracles depend on off-chain relayers/staked validators/trusted hardware → centralization risk, latency, liveness dependency. PropAMMs, market makers, and arbitrage bots operate sub-second and lose money to stale prices.
- **Solution:** Self-correcting oracle — every quote backed by bilateral collateral; any participant can profitably veto a wrong quote within a 2-block (~600ms) window (underpriced → buy+resell, overpriced → sell into quote asset). Surviving quotes become canonical. No validators, no off-chain feeds, fully permissionless. We validate this in a real scenario with IRMarket (irmarket.xyz): a permissionless options market built on the Monoracle primitive, where anyone can long or short any priced asset (A-shares, Labubu, the LLM stock 6658) — every trade is a Monoracle veto against a collateral-backed quote, option expiry equals the veto window, max loss is what you put in, no margin calls, and positions are derived live from on-chain events.

## Product & Tech

- **Product Link:** https://web-p0ljqigz9-h-fbf5.vercel.app (Monoracle); https://irmarket.xyz (IRMarket)
- **Web3 Verticals:** AI, DeFi, Infrastructure
- **Stage:** MVP
- **Chain:** Monad
- **Smart contract link:** https://testnet.monadscan.com/address/0x151286e6Ca5F5CA20910dE90C0DCEAa9fd71f2c8
- **Whitepaper link:** https://github.com/dixia/monoracle
- **Token economics link:** (blank)
- **Video demo:** (blank)

## Market

- **Target market:** High-frequency on-chain protocols on Monad needing block-level canonical price: PropAMMs, on-chain market making programs, arbitrage bots. Secondary: derivatives/options and prediction markets. Also AI-agent-driven DeFi.
- **Estimated market size:** $1B+ oracle services market (Chainlink + Pyth combined TAM); sub-second on-chain segment on parallel EVM L1s is early but growing.
- **Comparables:** Chainlink (centralized node operators), Pyth Network (off-chain relayers/staked validators), other on-chain oracles.
- **Differentiation:** Price accuracy enforced entirely on-chain via veto-arbitrage game with economic finality in ~600ms; no centralization, no relayers, no liveness dependency, fully permissionless, AI-agent native.

## Traction

- **Users/customers:** 0 paying users — early stage; validated on Monad testnet (full lifecycle). Talked with participants at the hack — quite a few were very interested in the Irrational Market/Monoracle.
- **Revenue:** $0. Post-MVP: provider fees on settlement or structured products.
- **First 10–1000 users:** Not yet. Validated with devs at Monad Blitz@Wuhan (1st). Next: onboard Monad protocols needing sub-second oracles.
- **Growth ideas:** 1) We built IRMarket (irmarket.xyz) and use it to drive GTM / adoption of the oracle — a consumer-facing options market that demonstrates Monoracle in a real scenario; 2) Integrate Monad ecosystem protocols; 3) OS veto bot + dashboard as reference infra to grow verifier network; 4) expand quote primitive into options/prediction markets/derivatives; 5) Monad Blitz/DeltaV communities.
- **Failed experiments:** None formal. Learning: bilateral collateral requirement is a provider participation barrier; exploring flash loans for verifiers, asymmetric collateral, structured products (see `plan/roadmap.md`).

## Fundraising

- **Prior funding:** No — bootstrapped. Won 1st at Monad Blitz@Wuhan.
- **Funding rounds:** none
- **Investors:** N/A
- **Fundraising now:** No
- **Pitch deck:** (blank)
- **TGE date:** (blank)

## Team

- **All founders full-time?** No
- **Full-time team size:** 0 — solo, bootstrapping
- **Founder video:** (blank)
- **Since when founders known each other:** N/A — solo
- **How did you meet:** N/A — solo founder

## Links

- **Company Website:** (blank)
- **GitHub:** https://github.com/dixia/monoracle
- **Twitter:** (blank)
- **Scheduling Link:** (blank)
- **Telegram:** https://t.me/imkurt
- **Discord:** (blank)
- **Other social 1/2/3:** (blank)
- **Telegram group with Monad team:** (blank)

## Analytics

(No fields)
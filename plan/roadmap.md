# Monoracle — Roadmap

## New Requirement: FLB-01 Flash-Loan-Powered Veto Bot

Spec: `bot/prd.md` (FR-FLB-001 .. FR-FLB-007). Product context: `product-analysis.md`.

### Milestones

- [ ] M1 — Research & selection of flash loan / flash-swap providers:
  - Reference protocols to study: **Aave** (flash loans), **Morpho** (flash loans), **Uniswap V3 / V4** (flash swaps).
  - Find the **Monad testnet equivalents** of each (deployments, adapters, or clones supporting the same interface — e.g., Aave-style `flashLoan`, Uniswap-style `flash` callback) and verify their addresses are live on testnet (Chain ID 10143). Research must be grounded in verifiable Monad testnet deployments.
  - Deliverable: a comparison table of provider / DEX routers, verified testnet addresses, flash-loan vs flash-swap support, and fee structures — to confirm `vetoUnderpriced`/`vetoOverpriced` collateral geometry fits an atomic flow before any implementation.
- [ ] M2 — Env config (`bot/.env.example`): add `FLASH_LOAN_ENABLED`, `FLASH_LOAN_PROVIDER`, `DEX_ROUTER`, `FLASH_LOAN_FEE_BPS`, with fallback to self-funded path when disabled (FR-FLB-005).
- [ ] M3 — Bot implementation (`bot/verifier.py`): atomic veto + swap + repayment transactions for underpriced/overpriced modes (FR-FLB-002/003/004).
- [ ] M4 — Profit gate update: include flash-loan fee + DEX slippage in `min_bps` break-even calculation (FR-FLB-006).
- [ ] M5 — Backward-compatible fallback: existing self-funded veto path unchanged when flash loans disabled (FR-FLB-005, FR-FLB-007).
- [ ] M6 — Test & deploy: Hardhat/local fork tests, Monad testnet dry-run, then activation.

### Notes / Constraints

- No changes to `Monoracle.sol` (FR-FLB-007).
- Flash-loan flow must be single-transaction atomic — revert on any repayment shortfall.
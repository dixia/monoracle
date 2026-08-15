# Product Analysis — Flash Loans as a Remedy for the Capital Participation Barrier

## The Mention (from `most-application.md`)

> 3. **Lowering the barrier to price quoting** — The current bilateral collateral requirement limits who can participate. Exploring alternative option structures or structured products that reduce capital requirements for price providers while maintaining economic security. A lot more to explore here.

**The problem:** Monoracle requires bilateral collateral — a provider locks `baseAmount` + `quoteAmount` into escrow at submission (`requirement.md` NFR-SEC-003: no minimum enforced, but the collateral must be fully escrowed), and a verifier must commit `quoteAmount`/`baseAmount` into escrow to veto (`requirement.md:100`). This high capital requirement raises the barrier to participation for both price **providers** and **verifiers**.

## Can Flash Loans Remedy the Barrier?

### 1. Verifier side — YES (strongest use case)

A veto costs a verifier real capital (`quoteAmount` or `baseAmount` pushed into escrow). A flash loan removes this need entirely, executed as one atomic transaction:

1. Flash-borrow `quoteAmount`/`baseAmount` from a Monad lending protocol (verify actual Monad testnet deployments — e.g., Aave-style, Morpho-style, or Uniswap-style flash-swap equivalents).
2. Call `vetoUnderpriced`/`vetoOverpriced` — the contract transfers the full collateral to the verifier.
3. Within the same tx, swap the received collateral on a Monad DEX to realize the arbitrage profit.
4. Repay the flash loan + fee.

Result: verifiers need **zero idle capital** to police the oracle. Lower barrier → more verifiers → stronger price security. The correlated arbitrage (mispricing → DEX price impact) must still make economic sense net of flash-loan fees, but the capital lock-up is eliminated.

### 2. Settlement arbitrage — YES

Arbitrage bots today must maintain inventory to trade against mispriced quotes at verification time. Flash loans let them borrow liquidity on demand for the settle/veto window, so no standing capital outlay is required to participate.

### 3. Provider (price quoting) side — NO (directly)

Provider collateral must remain **locked in escrow across the 2-block verification window and until withdrawal** (`requirement.md` FR-SV-004). A flash loan must be repaid within the same transaction it is taken — it cannot back collateral that must persist across blocks. So flash loans do **not** directly fund the provider's bilateral collateral.

### 4. Provider side — YES (indirectly, via atomic flows)

It works only if submission, verification, and withdrawal collapse into a single atomic flow — which the current 2-block window forbids. Possible future variant: if Monoracle supports same-block settle/withdraw for deterministic scenarios, a provider could flash-fund the quote and exit in one tx. Until then, provider-side remedies require capital-pooling structures instead:
- Asymmetric collateral (writer sets ratio, retail takes the other side) — `product/product_ideas.md` Idea 1
- Delta-neutral yield pools where retail capital is deployed as writer collateral — `product/product_ideas.md` Idea 3
- Structured/tranche products that lower per-provider commitment — `most-application.md:33`

## Summary

| Participant | Flash loan remedy | Notes |
|---|---|---|
| Verifier | Yes | Veto + arbitrage in one atomic tx; zero idle capital |
| Arbitrage bot | Yes | On-demand liquidity at the valuation window |
| Price provider (direct) | No | Escrow must persist across blocks; flash loan can't |
| Price provider (indirect) | Maybe (future) | Requires atomic submit→settle→withdraw flow, blocked by the 2-block window today |
# DeltaV Weekly Update — Monoracle / IRMarket

**Week of Aug 15–22, 2026**

---

## What we shipped

**Monoracle — Configurable Verification Window (CWV-01)**
- `submitQuote` now accepts `expiryBlock`; the verification window is `[startSlot, expiryBlock]`, capped at 12,000 slots but flexible. New errors: `ExpiryMustBeFuture`, `ExpiryTooFar`.
- Started rewriting some tests using Foundry (Monad fork). The codebase now includes 106 Hardhat tests + 12 new Foundry deterministic tests (using `vm.roll()` for exact block control) + live Monad testnet integration: **11/11 passing** against `0x151286e6Ca5F5CA20910dE90C0DCEAa9fd71f2c8`.
- Full call-site updates: `bot/verifier.py`, all demo/smoke/veto scripts, `requirement.md`.

**IRMarket — Web UI v0.9.2**
- All UI copy has been rewritten; canonical copy registry in `docs/product/ui_copy.md`.
- Market list now sorts still-quoting markets first, then soonest-expiry first.
- `docs/web-tech-design.md` rewritten to V0.9.2, references the copy registry and positions data-layer issue.
- some updates to decks making it easier to share with other devs

**IRMarket — Spec sync**
- `docs/sc-tech-spec.md` updated: `MonoracleWindowed` marked deprecated, `version()`, gas estimates, error codes, deploy flow, and round-scoping all synced to the current codebase.
- `docs/prd.md` updated accordingly.
- `todo.md` restructured as a GH-issue index.

**Competitive positioning**
- Added Chainlink/Perpl and Hyperliquid oracle comparison docs (`product/cmp_chainlink_perpl.md`, `product/cmp_hyperliquid_oracle.md`).
- Rewrote USP: Monoracle is an oracle with a **time settlement point**, not just a configurable window. Added PropAMM / on-chain market making as a primary use case (sub-second window = proportional pricing).

**DeltaV / ops**

- Added `deploy.md` release workflow and dotenv support for deploy scripts.

**Event log parsing**
- Started direct parsing of Monad event logs to improve verification freshness (code not yet open source).

**Oracle update research**
- Researching how other protocols handle oracle updates to inform Monoracle's design (code not open source).

---

## In progress / next

- **Verification freshness via event log parsing** — evaluating direct log parsing to reduce verification latency.
- **Oracle update pattern research** — studying competitor oracle update mechanisms (code not open source).
- **Flash-loan veto bot (FLB-01):** research phase — evaluating Aave / Morpho / Uniswap V3 flash-loan and flash-swap providers on Monad testnet. Deliverable: comparison table of verified testnet addresses, fee structures, and collateral geometry fit.
- **IRMarket positions data layer:** positions currently derived from on-chain events; next is a cached positions store for faster page loads.

---

## Metrics

| | |
|---|---|
| Monoracle testnet contract | `0x151286e6Ca5F5CA20910dE90C0DCEAa9fd71f2c8` |
| IRMarket live demo | `irmarket.xyz` |
| Monoracle test results | 106 Hardhat + 12 Foundry + 11/11 live integration |
| Repos synced | `monoracle-dev` (private) → `monoracle` (public) |

---

## blockers

- None. Flash-loan research is bounded by Monad testnet deployment availability for Aave/Morpho/Uniswap equivalents.

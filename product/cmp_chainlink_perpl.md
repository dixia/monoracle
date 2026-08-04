# Chainlink on Monad (via Perpl) vs Monoracle — Competitive Analysis

## TL;DR

Perpl — the flagship CLOB perp DEX on Monad — adopted **Chainlink Data Streams** as its official oracle for every market (BTC, ETH, SOL, MON, HYPE, ZEC). But Perpl does **not** consume a single "Chainlink mark price." It uses Chainlink purely for the **Spot Index (oracle/reference price)**, then computes its own **Mark Price** off-chain from four inputs and clamps it to a **±25 bps band around the Chainlink Spot Index**. Chainlink is the anchor; Perpl is the oracle that sits on top of it.

Two facts matter most for positioning:

1. **Chainlink's "sub-second" is off-chain only.** Data Streams generates signed reports off-chain at ≥1/sec and consumers pull them via WS/REST. On Monad, **Streams Trade (the on-chain push + Automation variant) is NOT deployed** — so a protocol must run its own permissioned relayer to move prices on-chain. On-chain freshness is gated by Monad block time (~0.5 s) plus the protocol's own push policy (Perpl: 0.1 % deviation / 10 s staleness), not by Chainlink.
2. **Chainlink is not "from Binance."** Crypto streams aggregate **3+ independent price data aggregators/vendors using CEX orderbook data** (Binance is one underlying CEX source feeding those aggregators), producing a DON consensus mid price. Exact vendor names are not public; it is neither a Binance-branded feed nor Binance-exclusive.

---

## 1. Does Perpl use Chainlink for mark price?

**Effectively yes, but with a layered design.** Perpl works with three prices ([Price Indices](https://docs.perpl.xyz/exchange/price-indices)):

| Price | What it is | Where it comes from |
|---|---|---|
| **Spot Index Price** | Fair spot price of the underlying | **Chainlink Data Streams**, pushed on-chain (one feed per market) |
| **Mark Price** | Robust estimate of the fair perp price | Computed **off-chain** from 4 sources, then **anchored to the Spot Index** (±25 bps) |
| **Funding Rate** | Payment keeping the perp near spot | Computed off-chain from the order book relative to the Spot Index |

Chainlink's Spot Index has three jobs: (1) **anchor for the Mark Price**, (2) **settlement basis for funding**, (3) **staleness guardrail** — the contract rejects settlement/liquidation if the on-chain Spot Index is older than its max permitted age.

Chainlink confirmed the integration as its "official oracle solution across all markets" (Nov 2025): Data Streams + DataLink, "sub-second, institutional-grade data" for margin consumption and liquidation triggering.

**Conclusion:** Perpl's mark price is anchored to Chainlink, so Chainlink effectively sets the reference. But the mark price itself is Perpl's own off-chain computation — it is not a raw Chainlink feed.

---

## 2. Perpl's own Mark Price oracle (how it combines Spot Index with its own price)

The Mark Price is recomputed **every block** from up to four independent inputs combined with a **median** so no single source dominates:

| # | Input | Source |
|---|---|---|
| 1 | **External price** | Weighted median of mid prices from **Binance, Hyperliquid, OKX, Bybit** for the corresponding perp |
| 2 | **Basis-adjusted fair value** | Spot Index scaled by smoothed (EMA) perp-vs-spot basis: `P_fair = (1 + avg_basis) × P_spot` (basis clamped to a small range) |
| 3 | **Impact mid price** | VWAP midpoint of walking Perpl's own order book to $1,000 / $2,000 / $5,000 notional depths |
| 4 | **Book price** | Median of best bid, best ask, last traded price (last trade dropped if stale) |

```text
P_median = median(P_ext, P_fair, P_impact, P_book)
P_mark   = clamp(P_median, (1 − δ)·P_spot, (1 + δ)·P_spot),   δ = 25 bps
```

- If fewer than four inputs are fresh, the median is backstopped by a smoothed order-book price, then by the raw Spot Index.
- **The ±0.25 % clamp is the most important guardrail:** the on-chain Mark Price can never sit more than a quarter of a percent from the Chainlink Spot Index, bounding manipulation from any single noisy input.
- Mark Price is written on-chain on a **>0.05 % move** or near expiry; the contract independently rejects any proposed mark outside its configured tolerance of the Spot Index.
- Funding is charged against the **Spot Index** (not the Mark Price), roughly hourly; the funding price must be within reference tolerance of the Chainlink oracle price and the oracle must **not be stale** (timestamp distance from block timestamp ≤ max reference price age).

**Read:** Perpl essentially operates its own permissioned multi-source oracle, using Chainlink's Spot Index as the binding reference band — an "oracle inside an oracle" architecture, with an off-chain service as the signer/relayer.

### The four prices are publicly readable on-chain

All of the prices above are **published on-chain state in Perpl's smart contracts on Monad** and can be read by anyone via a public RPC or a block explorer — **no credentialed API is needed for reads**:

- **Spot Index** (the Chainlink-anchored oracle price),
- **Mark Price** (the final published, clamped price),
- the **per-venue premium / basis** `b_i = P_mid / P_spot − 1` and its smoothed EMA average `avg_basis`,
- the **four mark inputs** used to build the median (external venue mid, basis-adjusted fair value, impact mid, book price).

| Contract | Mainnet | Testnet |
|---|---|---|
| **Exchange** (holds perp, margin, and pricing state — Spot Index / Mark / premium getters) | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` |
| **Collateral token (AUSD)** | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | `0xdf5b718d8fcc173335185a2a1513ee8151e3c027` |

> The exact getter function names are not documented; the values are readable from the Exchange contract's public state/views (confirm the ABI by reading the contract at chain ID `143`, RPC `https://rpc.monad.xyz`). The docs do not publish a separate "oracle contract" address — pricing state lives in the Exchange contract.

---

## 3. Which Chainlink feed does Perpl use, and is it from Binance?

**Product:** Chainlink **Data Streams** — the pull-based, low-latency crypto stream product (report schema **v3**, mid + LWBA bid/ask), **not** the classic push-based Data Feeds (V3 aggregator).

- One stream per market: BTC/USD, ETH/USD, SOL/USD, MON/USD, HYPE/USD, ZEC/USD.
- On-chain verification via the **VerifierProxy** on Monad: `0xC539169910DE08D237Df0d73BcDa9074c787A4a1` (per [Monad docs oracles page](https://docs.monad.xyz/tooling-and-infra/oracles)).
- Access model: credentialed REST/WebSocket/SDK API (requires sign-up and approval) — not a free public feed.

**Data sources — the DON consensus median:** Chainlink publishes only that crypto LWBA streams use **"3+ crypto price data aggregators and/or market data vendors using CEX orderbook data"** to produce Liquidity-Weighted Bid/Ask and Mid values ([Data Sources](https://docs.chain.link/data-streams/data-sources)). The specific vendor names are **not disclosed** ("contact us"). How it works:

- Each DON node independently fetches order-book data from those **independent aggregators/vendors**, computes the values it sees, and the nodes converge on a **consensus median** using Chainlink's Off-Chain Reporting (OCR). The result is a single **cryptographically signed report** per stream.
- Because it is a **median across multiple independent providers**, one bad/outlier vendor or exchange cannot dominate the reported price. Binance is one of the underlying CEX order-book sources feeding those vendors, but the final number is **not a Binance-branded feed and not Binance-exclusive**.
- A single point of trust is avoided, but note the set of vendors and node **operators is curated/vetted** (not permissionless), and API access itself requires credentials.

**What each crypto stream reports (v3 schema):** three prices per stream — a **Mid** price plus **Liquidity-Weighted Bid/Ask (LWBA)**:

| Price | Meaning |
|---|---|
| **Mid** | Consensus midpoint (good for funding benchmarks) |
| **LWBA Bid** | Volume-weighted price for buying — weights each price level by the liquidity available at that level, so larger orders' impact is captured |
| **LWBA Ask** | Volume-weighted price for selling — same liquidity-weighting on the ask side |

LWBA prices reflect **order-book depth**, not just the top of book, so they estimate realistic slippage and are more accurate under volatility than a bare mid. Perpl's Spot Index uses this stream as its anchor reference.

**Binance answer (accurate):**
- **Indirectly yes** — Binance order-book data feeds into the aggregators/vendors that Chainlink's DON nodes source from, and Binance is one of the dominant CEX venues for these assets.
- **Not exclusively** — the reported price is a DON consensus median across multiple independent data providers, not a Binance-branded feed.
- Note: Binance appears *explicitly* in Perpl's own mark-price input #1 (external venue mid from Binance/Hyperliquid/OKX/Bybit), which is separate from the Chainlink stream.

---

## 4. Time delay of the feed

| Layer | Reported latency | Mechanism |
|---|---|---|
| **Chainlink Data Streams (off-chain)** | **Sub-second** (reports designed ≥1/sec) | DON nodes continuously reach consensus (OCR), sign reports, and publish to the Aggregation Network; consumers pull via WS/REST with sub-second latency |
| **On-chain on Monad** | Bounded by **Monad block time (~0.5 s)** + protocol push policy | Streams Trade (Automation push) is **not available on Monad**; a protocol must run its own relayer to verify + write on-chain |
| **Perpl Spot Index on-chain cadence** | Push on **>0.1 % move** or **within 10 s of max permitted age** | Off-chain pricing service refreshes the on-chain Spot Index |
| **Perpl Mark Price on-chain cadence** | Push on **>0.05 % move** or near expiry | Off-chain service publishes the clamped median |
| **Staleness guardrail** | Contract rejects settlement/liquidation if the on-chain Spot Index is older than the **max reference price age** — a configurable parameter whose exact value is **not published**; Spot is pre-refreshed within 10 s of that age | Protects against trading on a frozen oracle; Monoracle has no aging window (fresh price every 2 blocks) |

### Does Chainlink publish stream prices on Monad natively? No — the developer must push them.

In **Data Streams** mode Chainlink does **not** write to Monad by itself. Data Streams is a **pull-based** product: Chainlink's DON generates signed reports **off the chain**, and the *consumer* must fetch them and carry them on-chain. Concretely for Perpl:

1. Perpl's off-chain pricing service subscribes to the **Data Streams Aggregation Network over WebSocket** (or REST/SDK) with **credentialed API access**, receiving the latest signed crypto-stream reports with **sub-second** off-chain latency.
2. Perpl's service then **verifies + writes the Spot Index (and its own Mark Price) on-chain itself** via Perpl's own transactions — this is Perpl's own permissioned "relayer" step, not Chainlink pushing to Monad.
3. So the **on-chain data freshness on Monad is decided by Perpl's push policy** (0.1 % deviation / 10 s before-expiry refresh for Spot; 0.05 % for Mark), **not** by Chainlink's sub-second generation.

### How the Monad VerifierProxy contract works

When Perpl (or any consumer) wants the report accepted on-chain, it calls the on-chain **`IVerifierProxy`** contract — on Monad mainnet at **`0xC539169910DE08D237Df0d73BcDa9074c787A4a1`** — with the signed bytes it pulled off-chain:

```
VerifierProxy.verify(signedReport, parameterPayload) → decodedReport
```

- The proxy **cryptographically checks the DON's signature** against the registry of authorized node keys and routes to the correct Verifier.
- On success it returns the decoded report (schema v3): `price`, `bid`, `ask`, plus `validFromTimestamp`, `observationsTimestamp`, and `expiresAt`.
- The report **cannot be verified past `expiresAt`**, so a stale/expired report is rejected at the verification layer; Perpl additionally enforces its own **max reference price age** (report timestamp vs current block) as a staleness guardrail before using the price for settlement/liquidation.

**Result:** on-chain, Chainlink's contribution is only the **verifier that vouches for an off-chain signed report**. Someone still has to pay the gas and choose *when* to bring each price on-chain — that someone is Perpl's permissioned service, not Chainlink and not any permissionless participant.

### Max reference price age

Perpl's docs state the Spot Index is refreshed when it is **within 10 seconds of its maximum permitted age**, and that settlement/liquidation is rejected if the on-chain price exceeds that maximum age (a **configurable contract parameter**, `maxRefPriceAge`/reference-price-age equivalent). The **exact numeric value is not published** in the public docs; it is bounded below by the 10-second pre-expiry refresh trigger (i.e., ≥ a few seconds to tens of seconds in practice) and enforced on-chain. Monoracle needs **no such parameter**: a fresh canonical price is settled on-chain every 2 blocks, so there is no aging window to guard.

---

## 5. Side-by-side: Chainlink on Monad (via Perpl) vs Monoracle

| Aspect | **Chainlink on Monad** (as used by Perpl) | **Monoracle** |
|---|---|---|
| **Delivery model** | Pull-based Data Streams (off-chain signed reports, on-demand verification) + **protocol-run relayer** to write on-chain; push-based Data Feeds also available but Perpl uses Streams | **Fully on-chain** on Monad |
| **Latency / freshness** | Sub-second off-chain; on-chain gated by Monad block time + Perpl push policy (0.1 %/10 s spot, 0.05 % mark); contract rejects stale oracle | Fresh canonical price every **2 blocks (~600 ms)** with economic finality; no staleness concept |
| **Sources** | Spot: 3+ independent CEX-orderbook aggregators (incl. Binance) via DON consensus. Mark: Perpl's 4-input median (Binance/Hyperliquid/OKX/Bybit + own book) clamped to spot | Permissionless provider quotes backed by bilateral collateral; anyone can quote |
| **Who can participate** | **Curated** — vetted Chainlink node operators, credentialed Data Streams API access, Perpl's permissioned pricing service/relayer | **Fully permissionless** — anyone can submit a quote, anyone can veto |
| **Trust model** | Trust in Chainlink DON (vetted operators, OCR consensus) + trust in Perpl's off-chain service (permissioned relayer) | **Cryptoeconomic skin-in-the-game** — no trusted node set, no curated publishers |
| **Security / integrity** | DON signature verification on-chain (VerifierProxy); 99.9 %+ uptime SLA; SVR on feeds | Veto arbitrage: a bad quote is profitably arbitraged against its locked collateral during the verification window |
| **Bad-price handling** | Aggregation tries to ignore outliers; ±25 bps spot clamp rejects off-band marks; staleness guardrail | Any bad quote is vetoed for profit → secondary-market arbitrage returns the price to market |
| **On-chain cost** | Perpl pays verification gas per update + pushes Spot/Mark (gas per refresh) | Quote + verification per 2-block cycle |
| **Frontrunning** | Commit-and-reveal / Streams Trade atomicity exists on other chains, **not on Monad**; timing handled by Perpl's relayer | Verification window is the arb mechanism itself; correction is a business model for agents |
| **Dependency on off-chain infra** | High — Chainlink API credentialing + Perpl relayer are required for on-chain data | Zero — no validators, no off-chain data feeds, no relayer |
| **AI-agent native** | No — feed vendors and relayer are permissioned; no open incentive for agents | Yes — agents optimize arbitrage against quotes and profit directly from corrections |

---

## 6. Bottom line

- **Chainlink on Monad = strong, but a "relayer-layered" oracle.** Data Streams gives sub-second *off-chain* reports and a proven DON, but on-chain freshness still depends on a permissioned protocol relayer (Streams Trade is absent on Monad). Perpl's mark price is itself a custom 4-input oracle clamped ±25 bps to Chainlink spot.
- **Binance is one input among many** — the Chainlink feed is a DON consensus over 3+ CEX-orderbook aggregators, not a Binance feed.
- **Monoracle differentiators:** fully on-chain canonical price every ~600 ms with economic finality, zero off-chain dependency, fully permissionless participation, no staleness window, and an explicit profit incentive for AI agents to correct prices — where Chainlink/Perpl still rely on curated node operators and a trusted relayer.

---

## Sources

- Perpl Docs — Price Indices: https://docs.perpl.xyz/exchange/price-indices.md
- Perpl Docs — Funding: https://docs.perpl.xyz/exchange/funding.md
- Perpl Docs — Networks & Configuration: https://docs.perpl.xyz/resources/for-developers/networks-and-configuration.md
- Cryptotimes — "Perpl Upgrades to Chainlink Data Streams on Monad": https://www.cryptotimes.io/2025/11/25/perpl-upgrades-to-chainlink-data-streams-on-monad/
- Chainlink Docs — Data Streams / Architecture / Data Sources / Crypto Streams: https://docs.chain.link/data-streams
- Chainlink Docs — Supported Networks (Streams Trade availability): https://docs.chain.link/data-streams/supported-networks
- Monad Docs — Oracles (Data Streams VerifierProxy): https://docs.monad.xyz/tooling-and-infra/oracles

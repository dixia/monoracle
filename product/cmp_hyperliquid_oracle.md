# Hyperliquid Oracle / Mark Price Mechanism vs Monoracle — Competitive Analysis

## TL;DR

Hyperliquid — the industry's reference CLOB perp DEX — runs its own **L1 app-chain** where a **stake-weighted validator set publishes spot oracle prices on-chain roughly every 3 seconds**, and the **mark price is a median of three robust inputs** (oracle + EMA, Hyperliquid's own order book, external perp mids). It is the closest thing perp land has to a production-grade "on-chain mark price update mechanism."

Two facts matter most for positioning:

1. **Hyperliquid's oracle is not fully on-chain — it is a hybrid.** Validators compute the oracle off-chain (weighted median of CEX spot mids) and publish it on-chain; the protocol computes the book component on-chain and takes the median. Integrity rests on a **permissioned, stake-weighted validator set**, not on economic dispute.
2. **Cadence is ~3 seconds on-chain** (10-second stale fallback, ±50 bps / ±1 % clamps per update). That is excellent for a perp DEX but 5x slower than Monoracle's ~600 ms (2-block) fully on-chain canonical price, which needs no validator, no relayer, and no staleness guardrail.

---

## 1. What Hyperliquid's oracle and mark price actually are

Hyperliquid maintains **two distinct on-chain prices** ([Robust price indices](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices)):

| Price | What it is | Where it comes from |
|---|---|---|
| **Oracle price** | Robust spot reference, used for **funding rates** and as a mark input | Weighted median of CEX **spot** mid prices, published by validators every ~3 s |
| **Mark price** | Unbiased estimate of fair perp price, used for **margining, liquidations, TP/SL, unrealized PnL** | **Median of three inputs** (below), recomputed each time validators publish oracle prices |

### Mark price — the exact formula

```text
input1 = oracle_price + EMA_150s(Hyperliquid mid − oracle_price)
input2 = median(best bid, best ask, last trade on Hyperliquid)
input3 = weighted median of external perp mids (Binance 3, OKX 2, Bybit 2, Gate IO 1, MEXC 1)

mark = median(input1, input2, input3)
```

- The EMA uses a 2.5-minute time constant (`ema = numerator/denominator`, both decayed by `exp(-t / 2.5 min)`).
- If exactly **two of the three** inputs exist, a 30-second EMA of `input2` is added to the median set.
- **On-chain mechanics:** the relayer/validators publish the oracle price and the EMA-adjusted component (`input1`); the Hyperliquid protocol computes `input2` from its own book and takes the median — so the mark price is a **hybrid of off-chain validator computation and on-chain book state**.
- Update rules: mark/oracle published **~once every 3 s**; stale mark falls back to the local book median after **10 s** of no updates; mark moves are **clamped to ±1 %** from the previous value (relayer submissions ±50 bps); all prices clamped to 10x start-of-day.

---

## 2. Which sources does Hyperliquid use, and is it from Binance?

**Spot oracle (funding):** each validator computes the weighted median of mid prices from **Binance, OKX, Bybit, Kraken, Kucoin, Gate IO, MEXC, and Hyperliquid spot** with weights **3, 2, 2, 1, 1, 1, 1, 1**. The final oracle used by the clearinghouse is the **stake-weighted median of each validator's submission**. Assets with primary spot liquidity on Hyperliquid (e.g. HYPE) exclude external sources until liquidity is sufficient; assets like BTC exclude Hyperliquid spot.

**Mark price (input 3):** weighted median of **Binance, OKX, Bybit, Gate IO, MEXC perp mids** (weights 3, 2, 2, 1, 1).

**Binance answer (accurate):**
- **Yes, heavily weighted — but not exclusive.** Binance carries the largest weight (3) in both the spot oracle and the perp-mid mark input, so it is the single biggest influence on Hyperliquid's prices.
- **It is still a weighted median across multiple CEXs** — no single venue (including Binance) can dictate the price. This is closer to "from Binance-weighted aggregation" than a pure Binance feed.

---

## 3. Time delay of the feed

| Layer | Latency | Mechanism |
|---|---|---|
| **Oracle / mark on-chain update** | **~3 seconds** | Validators publish oracle prices every ~3 s; mark recomputed on each publish |
| **Stale fallback** | **10 s** with no updates | Mark falls back to the local book median (best bid/ask/last) |
| **Per-update clamps** | ±50 bps (relayer) / **±1 % markPx** | Prevents sudden price jumps |
| **Aggregation** | Stake-weighted median of validator submissions | Requires validator majority (not an economic challenge) |

**Key takeaway:** Hyperliquid updates on-chain prices ~3×/second — very fast for a perp protocol, and faster than Chainlink/Perpl's on-Monad cadence. But it is still **validator-driven and periodic** (3 s + fallback rules), with clamps that can lag a fast market. Monoracle settles a **fresh canonical price every 2 blocks (~600 ms)** on-chain with **economic finality** — no validator schedule, no 3-second heartbeat, no staleness window, no clamp-induced lag.

---

## 4. Side-by-side: Hyperliquid Oracle/Mark vs Monoracle

| Aspect | **Hyperliquid Oracle / Mark** | **Monoracle** |
|---|---|---|
| **Chain / deployment** | Hyperliquid's **own L1 app-chain**; oracle + mark live on that chain | Fully on-chain, deployable on **Monad** (general EVM L1) |
| **Delivery model** | **Hybrid**: validators compute oracle off-chain → publish on-chain every ~3 s; book median computed on-chain; mark = on-chain median | **Fully on-chain** quote + verification, no off-chain component |
| **Cadence / freshness** | **~3 s** updates; 10 s stale fallback to book median; ±50 bps / ±1 % clamps | **Every 2 blocks (~600 ms)** canonical price with economic finality; no staleness concept |
| **What "the price" is** | Two prices: oracle (funding) + mark (median of 3 inputs) | Single canonical price per quote |
| **Sources** | Oracle: weighted median of 8 CEX spot mids (Binance 3, OKX 2, Bybit 2, Kraken/Kucoin/Gate/MEXC/HL 1 each). Mark: median of (oracle+150 s EMA), HL book (bid/ask/last), external perp mids (Binance 3, OKX 2, Bybit 2, Gate 1, MEXC 1) | Permissionless provider quotes backed by bilateral collateral; anyone can quote |
| **Binance influence** | Highest single weight (3) in oracle and perp-mid inputs, but a weighted median across many venues | No external venue dependency at all |
| **Who publishes prices** | **Validators** (stake-weighted, permissioned set) + relayer; protocol computes book median | **Anyone** — fully permissionless |
| **Trust model** | Trust in the **stake-weighted validator set** (aggregation robustness), plus Hyperliquid running its own chain | **Cryptoeconomic skin-in-the-game** — no trusted node or validator set |
| **Security / manipulation resistance** | Weighted medians + EMA smoothing + clamps + book state; proven at scale (JPY/March-2025 events tightened oracle weighting) | Veto arbitrage: a bad quote is profitably arbitraged against its locked collateral during the verification window |
| **Bad-price handling** | Aggregation and clamps dampen outliers; no direct economic penalty on a validator for a bad submission | Any bad quote is vetoed **for profit** → price corrected economically |
| **On-chain cost** | Validators/relayer pay to publish every 3 s (app-chain, subsidized) | Quote + verification per 2-block cycle |
| **Permissionless participation** | No — validator set is permissioned; oracle inputs are curated CEX venues | Yes — quote and challenge are both open to anyone |
| **AI-agent native** | No — publication is validator/relayer only; no open incentive to agents | Yes — agents optimize arbitrage against quotes and profit directly from corrections |
| **Track record** | Massive, battle-tested at scale (highest-volume perp DEX) | New; no live network effect yet |

---

## 5. Bottom line

- **Hyperliquid = the proven, hybrid, validator-driven standard.** A stake-weighted validator set pushes an 8-venue weighted-median spot oracle on-chain every ~3 s, and the mark price is a robust median of (oracle + EMA), Hyperliquid's own book, and external perp mids — the gold standard for production perp pricing. Its weakness is architectural: integrity rests on a permissioned validator set, cadence is periodic with clamps, and it runs on Hyperliquid's own chain, not a general L1.
- **Monoracle's edge over Hyperliquid's mechanism:** fully on-chain, **~5x fresher** (~600 ms vs ~3 s), **zero validator/relayer trust**, **fully permissionless** quote + challenge, no staleness window or clamp lag, and an **explicit profit incentive for AI agents** to keep prices honest — at the cost of not yet having Hyperliquid's scale or proven record.

---

## Sources

- Hyperliquid Docs — Oracle: https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle.md
- Hyperliquid Docs — Robust price indices: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices.md
- Hyperliquid Docs — Liquidations: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations.md
- Hyperliquid Docs — HIP-3 deployer actions (mark/oracle update rules): https://hyperliquid.gitbook.io/Hyperliquid-docs/for-developers/api/hip-3-deployer-actions

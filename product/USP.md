# Monoracle: An Oracle With a Time Expiry

**Traditional oracles (Chainlink, Pyth, etc.):** "Here's the price right now. Poll me again later."

**Monoracle:** "The price at block N will be final after K blocks of verification."

The difference: Monoracle doesn't just give you a price — it gives you a price **with a time settlement point**. The price isn't valid until the verification window closes. That time element is the product, not a config knob.

Other oracles provide a continuous price stream with no temporal finality. Monoracle provides discrete settlement events with a guaranteed block-level expiry — you know exactly *when* a price became canonical and *when* it will stop being disputable.

## What This Enables

| Use Case | Why Time Expiry Matters |
|---|---|
| **PropAMM / on-chain market making** | AMMs adjust swap ratios per-block. A 600ms price delay causes stale execution. Monoracle's sub-second verification window delivers canonical prices fast enough for proportional pricing. |
| **Options settlement** | "What was ETH's price at block 48,000,000?" — Monoracle settles at exactly that block, not at an oracle's next update. |
| **Short-term prediction markets** | A 1-hour binary contract expires at block N. Monoracle opens a settlement window at block N and confirms the price by block N+2. |
| **Cross-chain swaps** | Price commitment is valid for exactly K blocks. After that, the commitment expires and can't be executed. |
| **Scheduled derivatives expiry** | On-chain futures settle at a predetermined block. Monoracle provides the settlement price with built-in dispute resolution. |

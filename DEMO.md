# Live Demo: Monoracle — 5 Minutes

**Fair price: 100 QUOTE/BASE | Threshold: 100 bps (1%)**
Contract: `0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb` | Network: Monad Testnet (10143)

---

## Before Demo (prep)

1. Start the veto bot in a terminal:
   ```
   cd bot
   py verifier.py
   ```
   It will print: `Verifier: 0x...` — leave it running.

2. Open the frontend in Chrome: **http://localhost:3000**, connect MetaMask.

3. Close any other MetaMask popups.

---

## PATH 1: Valid Quote (2 min)

**Show the happy path — a fair price survives and becomes canonical.**

| # | Action | What happens | What to say |
|---|---|---|---|
| 1 | Frontend "Submit a Quote": price=**100**, baseAmount=**2** | Base=2, Quote=200 | "I'm submitting a quote at the market price. 100 QUOTE per 1 BASE." |
| 2 | Click **Submit Quote** | MetaMask: approve BASE → approve QUOTE → submitQuote | "3 transactions — approve both tokens, then the quote. Monad's 300ms block time makes this near-instant." |
| 3 | Show the tx confirmed | Quote enters ACTIVE, window = 2 slots (~600ms) | "The quote is now in a 600ms verification window. Anyone can veto it if the price is wrong." |
| 4 | **Check bot terminal** | Bot prints: `dev=0 bps < 100 → Skipped` | "Our veto bot checked the price. Deviation is 0 — it's fair. Bot ignores it." |
| 5 | Wait ~3 seconds, then refresh **"Read Latest Price"** on frontend | Click "Query" → shows price=100.0 | "The window passed, the quote settled, and the canonical price feed now reads 100.0." |

---

## PATH 2: Veto (2 min)

**Show the veto mechanism — a mispriced quote gets rejected.**

| # | Action | What happens | What to say |
|---|---|---|---|
| 1 | Frontend: change price to **75**, baseAmount=**2** | Base=2, Quote=150 | "Now I submit a quote with an intentionally wrong price — 75 instead of the true market price of 100." |
| 2 | Click **Submit Quote** | MetaMask: 3 tx again | "Same process — 600ms verification window opens." |
| 3 | **Switch to bot terminal immediately** | Bot prints: `dev=2500 bps >= 100 → VETO!` then tx hash | "The bot detected a 25% deviation! That's 2500 basis points — way above our 100 bps threshold. It automatically calls vetoUnderpriced." |
| 4 | Bot shows tx confirmed | Quote status = VETOED_UNDERPRICED | "In under 600ms, the bot spotted the mispricing, signed the veto transaction, and got it included before the window closed." |
| 5 | Return to frontend, click **"Read Latest Price"** → Query | Still shows **100.0** from Path 1 | "The canonical price is unchanged. The bogus 75 was rejected. The feed is clean." |
| 6 | (Optional) The provider loses 1 side of collateral | Underpriced veto: provider forfeits BASE, keeps 2x QUOTE | "And the provider? They lost their BASE collateral — the economic incentive to be honest." |

---

## Wrap-Up (1 min)

| What we showed | What it means |
|---|---|
| Valid quote → settles → feed updated | Honest providers contribute to the price feed |
| Mispriced quote → bot vetoes within 600ms | Dishonest quotes are economically punished |
| No oracle operator, no validator set | 100% permissionless — anyone can verify |
| Runs on Monad (300ms block, local mempool) | Fast enough for high-frequency DeFi |

**One command to start verifying:**
```
py bot/vetobot.py
```

Replace `FAIR_PRICES` with a real CEX/DEX API in production. Any wallet with approved tokens and MON for gas can run this bot — making the oracle truly decentralized.

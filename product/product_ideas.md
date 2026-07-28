# Monoracle Product Ideas

## Idea 1: Short-Term Options on Monad (Monoracle Options)

### Concept

An on-chain options market for 1-hour price contracts on BTC/ETH, built on Monoracle's bilateral collateral + veto mechanism. Unlike Polymarket's binary yes/no, this uses:
- **Asymmetric collateral** — writer (market maker) deposits one side, retail user deposits the other at a ratio set by the writer
- **Monoracle settlement** — at expiry, a short Monoracle window opens to determine the settlement price. Permissionless arbitration ensures fairness.
- **分级基金 payout** — each market has senior (fixed return) and junior (floating) tranches, plus a binary boost trigger if price exceeds a threshold

### Target Users

- **Option writers (market makers)**: Provide liquidity, earn theta decay, control their risk per strike
- **A-class retail**: Fixed-income style product, low risk, predictable 0.1-1% return per hour
- **B-class retail**: Leveraged directional bets with linear payout — no binary cliff
- **Arbitrageurs**: Profit from mispriced settlement quotes in the final Monoracle window

### Mechanics

```
1. Writer creates a market:
   - baseToken=BTC, quoteToken=USDC
   - strike=$105k, expiry in 12,000 blocks (~1 hour)
   - Deposits 0.1 BTC (maker's risk side)

2. Retail takes the other side:
   - Deposits 5,000 USDC at writer-set ratio
   - Can choose A-class (fixed return) or B-class (floating)

3. At expiry:
   - Monoracle settlement window opens (2 blocks)
   - Anyone can submit a price quote for settlement
   - If quote is wrong, vetoer profits → settlement price stays honest

4. Payout:
   - If BTC at expiry < strike: writer loses BTC to retail, keeps some USDC
   - If BTC at expiry > strike: writer keeps BTC, retail gets BTC or USDC depending on side
   - Binary boost: if |BTC - strike| > 5%, B-class gets extra 10% from writer's collateral
```

### Why Monad

- 300ms block time → 1 hour = 12,000 blocks → fine-grained expiry control
- ~$0.0006 per tx → creating and settling markets costs pennies
- No mempool → reduced front-running on settlement quotes

### Next Steps

- [ ] Whitepaper: Economic model of asymmetric collateral + veto settlement
- [ ] Contract: OptionMarket.sol with Monoracle settlement integration
- [ ] Frontend: Market creation UI + tradable position NFTs
- [ ] Bootstrapping: Seed with initial market makers (write BTC strangles)

---

## Idea 2: Price Band Contracts

A simpler variant: no options, just "BTC will be between X and Y at block Z." Provider locks collateral in the band. If price exits the band at expiry, retail takes the collateral. If price stays in band, provider wins.

---

## Idea 3: Delta-Neutral Yield Pools

Market makers deposit collateral across multiple strikes to create a delta-neutral book. Retail users farm yield by providing capital to the pool, which is deployed as writer collateral across all active markets. The pool earns the spread between A-class and B-class.

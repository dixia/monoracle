# Software Requirements Document: Monoracle

## 1. Project Overview & Scope

**Monoracle** is a fully permissionless, game-theoretic on-chain price oracle deployed on the Monad blockchain. Price accuracy is enforced entirely by economic incentives and on-chain arbitrage, with no centralized validator set or off-chain data feed.

### Mechanism Summary

Every price quotation is backed by bilateral collateral locked in an on-chain staking contract. For a fixed 2-slot verification window, any market participant may profitably veto an incorrect price by arbitraging against the locked collateral. Quotes that survive the window are confirmed as valid canonical prices.

Monoracle is natively **AI Agent friendly**. Because the arbitrage veto is a pure on-chain game, AI agents can continuously optimize their execution strategies — adjusting for gas costs, slippage, DEX routing, and market depth — to maximize profit from price corrections. This creates a self-improving system where better algorithms yield better prices for all consumers.

### Scope

- Permissionless participation for price providers and verifiers
- On-chain verification with economic incentives via bilateral collateral staking
- Monad-optimized for high performance (300ms block time, 600ms full finality), low gas fees, and async/parallel processing
- Excludes: Centralized oracles, off-chain validation, non-Monad blockchains, fee-on-transfer tokens, rebasing tokens

### Deployment Target

- Primary runtime: Monad EVM environment (Chain ID: 143 mainnet / 10143 testnet)

### Why Monand

- Leverages Monad native features: async/parallel execution, 300ms block time, speculative finality at 300ms / full finality at 600ms, low gas fees, Streaming RPC
- No global mempool: reduced front-running risk

---

## 2. Stakeholders & On-Chain Roles

All roles are fully permissionless; any EOA or contract address may participate with no whitelist.

1. **Price Provider**: Submits price quotations and deposits bilateral ERC20 collateral. Earns rewards for valid, un-vetoed quotes (reward mechanism deferred for future implementation). Forfeits one side of collateral if successfully vetoed.
2. **Verifier / Arbitrageur**: Monitors active quotes. Executes on-chain veto transactions against mispriced quotes and profits from secondary market arbitrage.
3. **Staking Contract**: Core on-chain escrow and state machine. Holds collateral, enforces verification windows, executes veto logic, and processes settlement/withdrawals.
4. **Secondary Market**: External on-chain ERC20 trading venue (DEX/AMM) used by verifiers to complete arbitrage. No direct on-chain integration required.
5. **Price Consumers**: External protocols that read settled canonical prices from the oracle contract.

---

## 3. Functional Requirements

### 3.1 Quote Lifecycle Management

- **FR-QL-001**: The contract shall define a `QuoteStatus` enum with states: `ACTIVE`, `VETOED_UNDERPRICED`, `VETOED_OVERPRICED`, `SETTLED_VALID`, `SETTLED_WITHDRAWN`.
- **FR-QL-002**: The contract shall define a `Quote` struct with fields:
  - `address provider`
  - `address baseToken`
  - `address quoteToken`
  - `uint256 baseAmount` (units of base token collateral)
  - `uint256 quoteAmount` (units of quote token collateral)
  - `uint256 price` (exchange rate: quote units per 1 base unit, 1e18 fixed-point)
  - `uint32 startSlot` (Monad block number at submission)
  - `uint32 settledSlot` (block number when settled; 0 if not settled)
  - `QuoteStatus status`
- **FR-QL-003**: All quotes shall have a fixed verification window of 2 Monad slots (600ms at 300ms block time) measured from `startSlot`.
- **FR-QL-004**: No veto or settlement action may be executed on a quote outside its valid state and time window.
- **FR-QL-005**: The contract shall assign a monotonically increasing `uint256 quoteId` to each new quotation.

### 3.2 Collateral Escrow & Accounting

- **FR-CE-001**: Collateral shall be accounted per-quote; funds from one quote may never be used for another quote's obligations.
- **FR-CE-002**: At submission, the Price Provider must deposit exactly `baseAmount` of base token AND `quoteAmount` of quote token, where `quoteAmount = baseAmount * price / 1e18`.
  - Example: MON/USDC price = 100 USDC/MON, `baseAmount = 2 MON` → `quoteAmount = 200 USDC`.
- **FR-CE-003**: The contract shall pull collateral via ERC20 `transferFrom` at submission time. The caller must have approved sufficient allowance.
- **FR-CE-004**: The contract shall use safe ERC20 transfer logic with return-value validation for all token movements.
- **FR-CE-005**: Collateral accounting shall be invariant-checked: sum of all user-entitled balances shall always equal contract token balances.

### 3.3 Veto Execution (Two Modes)

All veto functions are permissionless.

#### 3.3.1 Underpriced Veto (Base asset quoted below market)

Trigger: quoted price is so low that buying base asset from the contract and reselling on secondary market is profitable.

- **FR-VU-001**: Function: `vetoUnderpriced(uint256 quoteId) external`.
- **FR-VU-002**: Preconditions: quote status = `ACTIVE`, `block.number <= startSlot + 2`.
- **FR-VU-003**: Execution steps:
  1. Transfer full `quoteAmount` of quote token from verifier into the quote's escrow balance.
  2. Transfer full `baseAmount` of base token from escrow to verifier.
  3. Set quote status to `VETOED_UNDERPRICED`.
  4. Emit `QuoteVetoedUnderpriced(quoteId, verifier)`.
- **FR-VU-004**: Post-veto escrow: `0 baseToken`, `2 * quoteAmount quoteToken` (provider deposit + verifier payment).
  - Example: 0 MON remaining, 400 USDC total (200 original + 200 from verifier).

#### 3.3.3 Veto Profitability & Threshold

A veto is not free. The bot pays gas (~0.01 MON) and commits capital (pays `quoteAmount` or `baseAmount` into escrow). The net profit is:

```
Profit = (arbitrage gain on secondary market) − (gas cost) − (secondary market fees/slippage)
```

Example with `baseAmount = 1`, `price = 100`, 1 QUOTE ≈ $1, 1 MON ≈ $50:

- Fair price = 100.05 (5 bp deviation) → arbitrage gain is only **0.05 QUOTE** ($0.05)
- Gas cost = 0.01 MON ($0.50) → **losing trade**

With larger collateral (baseAmount = 1000) or more liquid pairs, even 1 bp becomes profitable. The threshold is a **minimum profit gate** preventing the bot from executing losing vetoes. It is configurable in basis points (bps): 100 bps = 1%, 5 bps = 0.05%.

#### 3.3.2 Overpriced Veto (Base asset quoted above market)

Trigger: quoted price is so high that selling base asset to the contract and rebuying on secondary market is profitable.

- **FR-VO-001**: Function: `vetoOverpriced(uint256 quoteId) external`.
- **FR-VO-002**: Preconditions: quote status = `ACTIVE`, `block.number <= startSlot + 2`.
- **FR-VO-003**: Execution steps:
  1. Transfer full `baseAmount` of base token from verifier into the quote's escrow balance.
  2. Transfer full `quoteAmount` of quote token from escrow to verifier.
  3. Set quote status to `VETOED_OVERPRICED`.
  4. Emit `QuoteVetoedOverpriced(quoteId, verifier)`.
- **FR-VO-004**: Post-veto escrow: `2 * baseAmount baseToken` (provider deposit + verifier payment), `0 quoteToken`.
  - Example: 4 MON total (2 original + 2 from verifier), 0 USDC remaining.

### 3.4 Settlement & Withdrawal

#### 3.4.1 Valid Quote Settlement (No Veto)

- **FR-SV-001**: Function: `settleValidQuote(uint256 quoteId) external`.
- **FR-SV-002**: Preconditions: quote status = `ACTIVE`, `block.number > startSlot + 2`.
- **FR-SV-003**: Execution: set status to `SETTLED_VALID`, record `settledSlot = block.number`, update canonical latest price for the asset pair, emit `QuoteSettledValid`.
- **FR-SV-004**: The provider is entitled to withdraw 100% of original collateral. Provider rewards are deferred for future implementation.
- **FR-SV-005**: Function: `withdrawProviderFunds(uint256 quoteId) external`. Only the quote's `provider` may call.

#### 3.4.2 Vetoed Quote Withdrawal

- **FR-SV-006**: Vetoed quotes may be withdrawn immediately after veto; no additional waiting period.
- **FR-SV-007**: For underpriced veto: provider receives `2 * quoteAmount` quote token and 0 base token.
- **FR-SV-008**: For overpriced veto: provider receives `2 * baseAmount` base token and 0 quote token.
- **FR-SV-009**: After successful withdrawal, status is set to `SETTLED_WITHDRAWN` and storage may be cleared for gas refund.

### 3.5 Price Feed Read Interface

- **FR-PF-001**: Function: `getLatestPrice(address baseToken, address quoteToken) external view returns (uint256 price, uint32 settledSlot, bool exists)`.
- **FR-PF-002**: The contract shall maintain a mapping from asset pair key to the most recently settled valid quote ID.
- **FR-PF-003**: All settled prices shall be permanently queryable by `quoteId` for on-chain auditability.

---

## 4. Non-Functional Requirements

### 4.1 Monad-Specific Performance

- **NFR-MON-001**: All timing logic shall use `block.number` (Monad slot counter). `block.timestamp` shall not be used for verification windows.
- **NFR-MON-002**: Storage layout shall minimize storage slot contention between independent quotes, maximizing throughput under Monad's parallel/async execution engine.
- **NFR-MON-003**: Settlement finality aligns with Monad's 600ms full finality (2 slots at 300ms each).
- **NFR-MON-004**: All state-changing functions shall emit indexed events to support Monad Streaming RPC for real-time price consumers.
- **NFR-MON-005**: Gas usage shall be optimized to take advantage of Monad's low fee structure, noting Monad charges by gas limit (not gas used). Users should be informed of recommended gas limits per operation.

### 4.2 Security

- **NFR-SEC-001**: All token transfer functions shall use reentrancy protection (OpenZeppelin ReentrancyGuard).
- **NFR-SEC-002**: No owner/admin privileged functions exist. The contract is fully immutable. No functions can withdraw user funds, alter active quotes, or modify the verification window.
- **NFR-SEC-003**: No minimum collateral requirement — the market determines economic viability of quotes and vetoes.

### 4.3 Compatibility

- **NFR-COMP-001**: Written in Solidity ^0.8.20, compatible with Monad EVM.
- **NFR-COMP-002**: Compatible with standard ERC20 tokens only. Fee-on-transfer and rebasing tokens are not supported.
- **NFR-COMP-003**: Deposits exactly decimals (token-native precision); the contract does not perform decimal normalization between base and quote tokens.

---

## 5. Process / Data Flow Rules

### 5.1 Valid Price Flow (No Veto)

1. **Submission**: Provider calls `submitQuote(baseToken, quoteToken, baseAmount, price)`, having approved collateral allowance. Contract pulls `baseAmount` base token and `quoteAmount` quote token, creates `ACTIVE` quote, records `startSlot = block.number`, emits `QuoteSubmitted`.
2. **Verification Window**: Quote remains open for veto for exactly 2 slots (600ms). Verifiers observe on-chain state.
3. **No Veto**: Market judges the price accurate; arbitrage would be unprofitable, so no on-chain action is taken.
4. **Settlement**: After `block.number > startSlot + 2`, anyone calls `settleValidQuote`. Status becomes `SETTLED_VALID`; canonical price feed updates.
5. **Withdrawal**: Provider calls `withdrawProviderFunds` and receives full original collateral.

### 5.2 Underpriced Veto Flow (Quote Too Cheap)

1. **Submission**: Provider deposits 2 MON + 200 USDC, quotes MON/USDC = 100. Quote enters ACTIVE state.
2. **Veto Trigger**: Verifier determines true market price is 120 (MON undervalued in quote).
3. **On-Chain Veto**: Verifier calls `vetoUnderpriced`. Contract pulls 200 USDC from verifier and sends 2 MON to verifier. Status becomes `VETOED_UNDERPRICED`.
4. **Off-Chain Arbitrage**: Verifier sells 2 MON on secondary market at 120, receives 240 USDC. Net profit = 240 - 200 = 40 USDC.
5. **Provider Withdrawal**: Provider withdraws 400 USDC (200 original + 200 from verifier) and 0 MON.

### 5.3 Overpriced Veto Flow (Quote Too Expensive)

1. **Submission**: Provider deposits 2 MON + 200 USDC, quotes MON/USDC = 100. Quote enters ACTIVE state.
2. **Veto Trigger**: Verifier determines true market price is 80 (MON overvalued in quote).
3. **On-Chain Veto**: Verifier calls `vetoOverpriced`. Contract pulls 2 MON from verifier and sends 200 USDC to verifier. Status becomes `VETOED_OVERPRICED`.
4. **Off-Chain Arbitrage**: Verifier buys 2 MON on secondary market at 80, spending 160 USDC. Net profit = 200 - 160 = 40 USDC.
5. **Provider Withdrawal**: Provider withdraws 4 MON (2 original + 2 from verifier) and 0 USDC.

---

## 6. System Architecture

### 6.1 Contract Modules

| Module | File | Responsibility |
|---|---|---|
| `Monoracle.sol` | `contracts/Monoracle.sol` | Core entry point: submission, veto, settlement, withdrawal, price reads. All business logic in a single immutable contract. |

### 6.2 Storage Layout

- `mapping(uint256 => Quote) public quotes` — primary quote storage by ID
- `mapping(bytes32 => uint256) public latestValidQuoteId` — asset pair key → latest settled valid quote ID
- `uint256 public nextQuoteId` — auto-incrementing ID counter
- Each `Quote` struct shall be packed to occupy minimal storage slots, and independent quotes shall not share hot storage slots, to maximize parallel execution on Monad.

### 6.3 External Dependencies

- **Monad L1**: Consensus, block slot timing, EVM execution, transaction finality
- **ERC20 Tokens**: Standard `approve` / `transferFrom` / `balanceOf` interface
- **OpenZeppelin Contracts v5.x**: `SafeERC20` library, `ReentrancyGuard` contract
- **Secondary Markets**: No on-chain integration; verifiers interact with external DEXs directly
- **Streaming RPC**: Event-based real-time data delivery for price consumers, native to Monad

---

## 7. Assumptions, Constraints & Risks

### 7.1 Assumptions

- 1 Monad slot = 300ms (confirmed as of v0.15.0+, MIP-12)
- A single veto consumes 100% of one side of collateral; partial vetoes are not supported
- All supported tokens use standard ERC20 semantics
- Verifiers handle their own off-chain price discovery and secondary market routing
- First-come-first-served semantics for concurrent veto attempts on the same quote
- Monad does not have a public mempool (local mempools only), reducing front-running risk

### 7.2 Constraints

- Fixed 2-slot verification window for all asset pairs
- Fully permissionless participation; no whitelists or access control
- All logic executes on-chain; no off-chain oracle data is trusted
- Contract is fully immutable; no upgrade mechanism or governance
- Standard ERC20 tokens only; no fee-on-transfer or rebasing tokens

### 7.3 Risks

- **Verification Collusion**: Verifiers may collude with providers to submit strategically mispriced quotes. Mitigation: requires capital commitment and exposes participants to counter-party arbitrage risk.
- **Low Secondary Market Liquidity**: Reduces verifier incentive and weakens price security. Without profitable arbitrage opportunities, no verifier will veto.
- **Decimal Mismatch**: Different decimals between base and quote tokens may break collateral accounting if not handled correctly by providers setting the price.
- **Staking Insolvency**: Providers may lack assets to cover collateral obligations. Mitigation: collateral is escrowed upfront at submission time.
- **Oracle Latency**: 600ms verification window may be insufficient for verifiers to detect and act on mispriced quotes.
- **Reserve Balance**: Monad requires 10 MON reserve balance per EOA. Providers and verifiers must maintain this in addition to staked amounts.

---

## 8. Monad Technical Reference

| Parameter | Value | Source |
|---|---|---|
| Block time | 300ms | v0.15.0 (MIP-12) |
| Speculative finality | 300ms (1 slot) | MonadBFT |
| Full finality | 600ms (2 slots) | MonadBFT |
| Verification window | 600ms (2 slots) | Design choice |
| Per-transaction gas limit | 30M gas | Network params |
| Block gas limit | 200M gas | Network params |
| Gas charging model | Charged by gas limit | Monad-specific |
| Minimum base fee | 100 MON-gwei | Network params |
| Max contract size | 128 KB | MONAD_TWO+ |
| Mempool | Local only (no global) | Monad architecture |
| Reserve balance | 10 MON per EOA | MONAD_FOUR+ |
| EVM revision | MONAD_NINE | Current (Osaka + CLZ) |
| Chain ID (mainnet) | 143 | Mainnet |
| Chain ID (testnet) | 10143 | Testnet |

---

## 9. Deferred Features (Future)

The following features are explicitly deferred and will not be implemented in the initial version:

1. **Provider rewards for accurate quotes**: Reward formula, funding source, and reward token are undefined. The contract structure leaves room for future reward distribution logic.
2. **Governance / upgrade mechanism**: The contract is fully immutable in v1.
3. **Fee-on-transfer token support**: Only standard ERC20 tokens are supported.
4. **Rebasing token support**: Only standard ERC20 tokens are supported.
5. **Partial vetoes**: Vetoes always consume 100% of one side of collateral.
6. **Multiple verifier reward splitting**: Single verifier receives full arbitrage profit.
7. **Canonical price aggregation**: `getLatestPrice` returns the most recent single valid quote.
8. **Reputation system**: No on-chain reputation tracking for providers or verifiers.

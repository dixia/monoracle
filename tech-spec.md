# Monoracle — Technical Specification (Monad)

## 1. Contract Overview

| Field | Value |
|---|---|
| **Contract name** | `Monoracle` |
| **File** | `contracts/Monoracle.sol` |
| **License** | MIT |
| **Solidity version** | `^0.8.20` |
| **Dependencies** | OpenZeppelin Contracts v5.x (`SafeERC20`, `ReentrancyGuard`) |
| **Inheritance** | `ReentrancyGuard` |
| **Immutability** | Fully immutable; no upgrade mechanism, no owner, no admin |
| **Target chain** | Monad (chain ID 143 mainnet / 10143 testnet) |

---

## 2. Types & Constants

### 2.1 Enums

```solidity
enum QuoteStatus {
    ACTIVE,               // 0: Submitted, in verification window
    VETOED_UNDERPRICED,   // 1: Base asset quoted too low (verifier took base)
    VETOED_OVERPRICED,    // 2: Base asset quoted too high (verifier took quote)
    SETTLED_VALID,        // 3: Survived verification, canonical price confirmed
    SETTLED_WITHDRAWN     // 4: Provider has withdrawn funds (terminal state)
}
```

### 2.2 Structs

```solidity
struct Quote {
    address provider;       // 20 bytes — msg.sender at submission
    address baseToken;      // 20 bytes — base asset ERC20 (e.g. MON)
    address quoteToken;     // 20 bytes — quote asset ERC20 (e.g. USDC)
    uint256 baseAmount;     // 32 bytes — collateral amount of base token
    uint256 quoteAmount;    // 32 bytes — collateral amount of quote token
    uint256 price;          // 32 bytes — quote per base, 1e18 fixed-point
    uint32  startSlot;      //  4 bytes — block.number at submission
    uint32  settledSlot;    //  4 bytes — block.number at settlement (0 if not settled)
    QuoteStatus status;     //  1 byte  — current state
}
```

Storage slot layout (packing optimization):
- Slot 0: `provider` (20) + `baseToken` (20) + `quoteToken` (20) + padding (4)  — all addresses fit in one slot
- Slot 1: `baseAmount`
- Slot 2: `quoteAmount`
- Slot 3: `price`
- Slot 4: `startSlot` (4) + `settledSlot` (4) + `status` (1) + padding (23)

### 2.3 Constants

```solidity
uint32 public constant VERIFICATION_SLOTS = 2;   // ~600ms at 300ms block time
```

---

## 3. State Variables

| Name | Type | Visibility | Description |
|---|---|---|---|
| `nextQuoteId` | `uint256` | public | Auto-incrementing quote ID counter |
| `quotes` | `mapping(uint256 => Quote)` | public | Primary quote storage by ID |
| `latestValidQuoteId` | `mapping(bytes32 => uint256)` | public | Asset pair key → latest valid quote ID |

Pair key format: `keccak256(abi.encodePacked(baseToken, quoteToken))`

---

## 4. Events

All events use `indexed` params for Monad Streaming RPC compatibility.

### QuoteSubmitted

```solidity
event QuoteSubmitted(
    uint256 indexed quoteId,
    address indexed provider,
    address indexed baseToken,
    address quoteToken,
    uint256 baseAmount,
    uint256 quoteAmount,
    uint256 price,
    uint32  startSlot
);
```

Emitted when a new quote is created via `submitQuote()`.

### QuoteVetoedUnderpriced

```solidity
event QuoteVetoedUnderpriced(
    uint256 indexed quoteId,
    address indexed verifier
);
```

Emitted when a verifier executes an underpriced veto.

### QuoteVetoedOverpriced

```solidity
event QuoteVetoedOverpriced(
    uint256 indexed quoteId,
    address indexed verifier
);
```

Emitted when a verifier executes an overpriced veto.

### QuoteSettledValid

```solidity
event QuoteSettledValid(
    uint256 indexed quoteId,
    uint256 price
);
```

Emitted when a quote survives the verification window and is settled as valid.

### FundsWithdrawn

```solidity
event FundsWithdrawn(
    uint256 indexed quoteId,
    address indexed provider,
    uint256 baseAmount,
    uint256 quoteAmount
);
```

Emitted when a provider withdraws funds after settlement or veto.

---

## 5. Function Specifications

### 5.1 submitQuote

```solidity
function submitQuote(
    address baseToken,
    address quoteToken,
    uint256 baseAmount,
    uint256 price
) external nonReentrant returns (uint256 quoteId);
```

#### Parameters

| Name | Type | Description |
|---|---|---|
| `baseToken` | `address` | Base asset ERC20 token address |
| `quoteToken` | `address` | Quote asset ERC20 token address |
| `baseAmount` | `uint256` | Amount of base token to deposit as collateral (token-native units) |
| `price` | `uint256` | Quoted exchange rate: quote tokens per 1 base token, scaled 1e18 |

#### Returns

| Name | Type | Description |
|---|---|---|
| `quoteId` | `uint256` | Unique ID of the created quote |

#### Requirements

- `baseAmount > 0`
- `price > 0`
- `baseToken != address(0)`
- `quoteToken != address(0)`
- `baseToken != quoteToken`
- Caller must have approved `baseAmount` of `baseToken` AND `quoteAmount` of `quoteToken` to the contract
- `quoteAmount = (baseAmount * price) / 1e18` must be `> 0`

#### Execution

1. Calculate `quoteAmount = (baseAmount * price) / 1e18`
2. Pull `baseAmount` of `baseToken` via `safeTransferFrom(msg.sender, address(this), baseAmount)`
3. Pull `quoteAmount` of `quoteToken` via `safeTransferFrom(msg.sender, address(this), quoteAmount)`
4. Assign `quoteId = nextQuoteId++`
5. Store new `Quote` struct with status `ACTIVE` and `startSlot = uint32(block.number)`
6. Emit `QuoteSubmitted`

#### Gas Estimate (approximate)

~120,000 — 150,000 gas (two ERC20 transfers + storage writes)

---

### 5.2 vetoUnderpriced

```solidity
function vetoUnderpriced(uint256 quoteId)
    external
    nonReentrant
    quoteExists(quoteId)
    inVerificationWindow(quoteId);
```

#### Parameters

| Name | Type | Description |
|---|---|---|
| `quoteId` | `uint256` | ID of the active quote to veto |

#### Requirements

- Quote exists (`modifier quoteExists`)
- Quote is within verification window: `block.number <= startSlot + 2` (`modifier inVerificationWindow`)
- Quote status is `ACTIVE`
- Verifier must have approved `quoteAmount` of `quoteToken` to the contract

#### Execution

1. Read quote from storage
2. Require `q.status == QuoteStatus.ACTIVE`
3. Pull `q.quoteAmount` of `q.quoteToken` from verifier
4. Send `q.baseAmount` of `q.baseToken` to verifier
5. Set `q.status = QuoteStatus.VETOED_UNDERPRICED`
6. Emit `QuoteVetoedUnderpriced(quoteId, msg.sender)`

#### Post-Veto Balance

- Contract holds: 0 baseToken, `2 * quoteAmount` quoteToken
- Verifier receives: full `baseAmount` (to arbitrage on secondary market)

#### Gas Estimate (approximate)

~80,000 — 100,000 gas (one ERC20 transferFrom + one ERC20 transfer + storage write)

---

### 5.3 vetoOverpriced

```solidity
function vetoOverpriced(uint256 quoteId)
    external
    nonReentrant
    quoteExists(quoteId)
    inVerificationWindow(quoteId);
```

#### Parameters

| Name | Type | Description |
|---|---|---|
| `quoteId` | `uint256` | ID of the active quote to veto |

#### Requirements

- Quote exists (`modifier quoteExists`)
- Quote is within verification window: `block.number <= startSlot + 2` (`modifier inVerificationWindow`)
- Quote status is `ACTIVE`
- Verifier must have approved `baseAmount` of `baseToken` to the contract

#### Execution

1. Read quote from storage
2. Require `q.status == QuoteStatus.ACTIVE`
3. Pull `q.baseAmount` of `q.baseToken` from verifier
4. Send `q.quoteAmount` of `q.quoteToken` to verifier
5. Set `q.status = QuoteStatus.VETOED_OVERPRICED`
6. Emit `QuoteVetoedOverpriced(quoteId, msg.sender)`

#### Post-Veto Balance

- Contract holds: `2 * baseAmount` baseToken, 0 quoteToken
- Verifier receives: full `quoteAmount` (to arbitrage on secondary market)

#### Gas Estimate (approximate)

~80,000 — 100,000 gas (one ERC20 transferFrom + one ERC20 transfer + storage write)

---

### 5.4 settleValidQuote

```solidity
function settleValidQuote(uint256 quoteId)
    external
    quoteExists(quoteId)
    afterVerificationWindow(quoteId);
```

#### Parameters

| Name | Type | Description |
|---|---|---|
| `quoteId` | `uint256` | ID of the active quote to settle |

#### Requirements

- Quote exists (`modifier quoteExists`)
- Quote is after verification window: `block.number > startSlot + 2` (`modifier afterVerificationWindow`)
- Quote status is `ACTIVE`

#### Execution

1. Read quote from storage
2. Require `q.status == QuoteStatus.ACTIVE`
3. Set `q.status = QuoteStatus.SETTLED_VALID`
4. Set `q.settledSlot = uint32(block.number)`
5. Update `latestValidQuoteId[_getPairKey(q.baseToken, q.quoteToken)] = quoteId`
6. Emit `QuoteSettledValid(quoteId, q.price)`

#### Gas Estimate (approximate)

~40,000 — 60,000 gas (storage writes only)

---

### 5.5 withdrawProviderFunds

```solidity
function withdrawProviderFunds(uint256 quoteId)
    external
    nonReentrant
    quoteExists(quoteId);
```

#### Parameters

| Name | Type | Description |
|---|---|---|
| `quoteId` | `uint256` | ID of the quote to withdraw from |

#### Requirements

- Quote exists (`modifier quoteExists`)
- `msg.sender == q.provider`
- Quote status is one of: `SETTLED_VALID`, `VETOED_UNDERPRICED`, `VETOED_OVERPRICED`

#### Execution

| Quote Status | baseAmount withdrawn | quoteAmount withdrawn |
|---|---|---|
| `SETTLED_VALID` | `q.baseAmount` | `q.quoteAmount` |
| `VETOED_UNDERPRICED` | `0` | `q.quoteAmount * 2` |
| `VETOED_OVERPRICED` | `q.baseAmount * 2` | `0` |

After transfers, set `q.status = SETTLED_WITHDRAWN` and emit `FundsWithdrawn`.

#### Gas Estimate (approximate)

~50,000 — 80,000 gas (ERC20 transfers + storage write)

---

### 5.6 getLatestPrice

```solidity
function getLatestPrice(address baseToken, address quoteToken)
    external
    view
    returns (uint256 price, uint32 settledSlot, bool exists);
```

#### Parameters

| Name | Type | Description |
|---|---|---|
| `baseToken` | `address` | Base asset ERC20 token address |
| `quoteToken` | `address` | Quote asset ERC20 token address |

#### Returns

| Name | Type | Description |
|---|---|---|
| `price` | `uint256` | Canonical price (quote per base, 1e18 fixed-point). 0 if no valid quote exists. |
| `settledSlot` | `uint32` | Block number when the price was settled. 0 if no valid quote exists. |
| `exists` | `bool` | Whether a valid price exists for this pair. |

#### Execution

1. Compute `pairKey = keccak256(abi.encodePacked(baseToken, quoteToken))`
2. Look up `quoteId = latestValidQuoteId[pairKey]`
3. If `quoteId == 0`, return `(0, 0, false)`
4. Read `Quote` struct from storage
5. Return `(q.price, q.settledSlot, true)`

#### Gas Estimate

~5,000 — 10,000 gas (read-only `eth_call`)

---

### 5.7 getQuote

```solidity
function getQuote(uint256 quoteId)
    external
    view
    returns (Quote memory);
```

Returns the full `Quote` struct for a given ID. Reverts if the quote does not exist.

---

## 6. Modifiers

| Modifier | Description |
|---|---|
| `quoteExists(uint256 quoteId)` | Reverts if `quotes[quoteId].provider == address(0)` |
| `inVerificationWindow(uint256 quoteId)` | Reverts if `block.number > startSlot + VERIFICATION_SLOTS` |
| `afterVerificationWindow(uint256 quoteId)` | Reverts if `block.number <= startSlot + VERIFICATION_SLOTS` |

---

## 7. Internal Helpers

```solidity
function _getPairKey(address baseToken, address quoteToken)
    internal pure returns (bytes32)
{
    return keccak256(abi.encodePacked(baseToken, quoteToken));
}
```

Note: `baseToken` and `quoteToken` order matters. `pair(USDC, DAI)` is distinct from `pair(DAI, USDC)`.

---

## 8. Error Messages

| Condition | Error |
|---|---|
| `baseAmount == 0` | `"Zero base amount"` |
| `price == 0` | `"Zero price"` |
| `quoteAmount == 0` | `"Quote amount too small"` |
| `baseToken == quoteToken` | `"Identical tokens"` |
| `baseToken == address(0)` or `quoteToken == address(0)` | `"Invalid token"` |
| Quote does not exist | `"Quote does not exist"` |
| Outside verification window (veto) | `"Verification window expired"` |
| Inside verification window (settle) | `"Verification window active"` |
| Quote not ACTIVE | `"Quote not active"` |
| Not the quote provider (withdraw) | `"Only quote provider"` |
| Invalid state for withdrawal | `"Not withdrawable"` |

---

## 9. Integration Guide

### 9.1 For Price Providers

1. **Approve tokens**: Call `baseToken.approve(giroOracle, baseAmount)` and `quoteToken.approve(giroOracle, quoteAmount)`
2. **Calculate quoteAmount**: `quoteAmount = baseAmount * price / 1e18`
3. **Submit**: Call `submitQuote(baseToken, quoteToken, baseAmount, price)`
4. **Wait for settlement**: After `startSlot + 3` blocks, call (or wait for anyone to call) `settleValidQuote(quoteId)`
5. **Withdraw**: Call `withdrawProviderFunds(quoteId)`

### 9.2 For Verifiers / Arbitrageurs

1. **Monitor events**: Listen for `QuoteSubmitted` events via Streaming RPC, or poll `quotes` mapping
2. **Compare with market**: Check if quoted price deviates from external market price
3. **If underpriced**: Call `vetoUnderpriced(quoteId)` — must have approved `quoteAmount` of quote token
4. **If overpriced**: Call `vetoOverpriced(quoteId)` — must have approved `baseAmount` of base token
5. **Arbitrage**: Complete the arbitrage on a secondary DEX/AMM

### 9.3 For Price Consumers (DeFi Protocols)

```solidity
(uint256 price, uint32 settledSlot, bool exists) = giroOracle.getLatestPrice(baseToken, quoteToken);
require(exists, "Oracle: no price for pair");
// Use `price` with 1e18 precision
```

---

## 10. Monad-Specific Considerations

### 10.1 Gas Model

Monad charges by **gas limit**, not gas used. Providers and verifiers should set precise gas limits:

| Operation | Recommended Gas Limit |
|---|---|
| `submitQuote` | 180,000 |
| `vetoUnderpriced` / `vetoOverpriced` | 120,000 |
| `settleValidQuote` | 70,000 |
| `withdrawProviderFunds` | 100,000 |

### 10.2 No Public Mempool

Monad uses local mempools. Transactions are forwarded to the next 3 leaders. This means:
- Verifiers cannot see pending submissions
- Front-running price submissions is unlikely
- Verifiers must act within ~600ms (2 slots) after the quote appears on-chain

### 10.3 Reserve Balance

All EOAs must maintain at least **10 MON** reserve balance. Providers and verifiers must ensure sufficient MON balance beyond collateral requirements.

### 10.4 Parallel Execution

Monad executes independent transactions in parallel. The `mapping(uint256 => Quote)` storage pattern ensures quotes for different `quoteId` values touch different storage slots, maximizing parallel throughput.

### 10.5 Streaming RPC

All 5 events have indexed parameters. Price consumers should subscribe via Monad's websocket RPC:

```javascript
// Listen for new settled prices
ws.on('QuoteSettledValid', (event) => {
  const { quoteId, price } = event.args;
  // Update local price cache
});
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Category | Tests |
|---|---|
| **Submission** | Valid submission, zero amounts, insufficient allowance, same tokens, edge amounts |
| **Underpriced veto** | Successful veto, fail when window expired, fail when already vetoed, fail when settled |
| **Overpriced veto** | Successful veto, fail when window expired, fail when already vetoed, fail when settled |
| **Settlement** | Successful settle after window, fail during window, fail when already settled, fail when vetoed |
| **Withdrawal (valid)** | Provider withdraws full collateral after settlement |
| **Withdrawal (underpriced veto)** | Provider withdraws 2x quote, 0 base |
| **Withdrawal (overpriced veto)** | Provider withdraws 2x base, 0 quote |
| **Withdrawal (unauthorized)** | Non-provider cannot withdraw |
| **Price feed** | getLatestPrice after settlement, unknown pair, multiple quotes for same pair |
| **State transitions** | All valid and invalid state transitions |
| **Reentrancy** | Attempt reentrant calls on veto/withdrawal |

### 11.2 Integration Tests

- Full lifecycle: submit → veto → withdraw
- Full lifecycle: submit → settle → withdraw
- Multiple concurrent quotes for different pairs
- Multiple concurrent quotes for same pair
- Event emission verification

### 11.3 Edge Cases

- `baseAmount * price` overflow (should use Solidity 0.8's checked arithmetic)
- Token with 0 decimals
- Token with 6 vs 18 decimals mismatch
- Very large `baseAmount` (near type(uint256).max)
- Token that returns false instead of reverting on transfer

---

## 12. Deployment

### 12.1 Prerequisites

- Foundry installed (`forge` + `cast`)
- Monad RPC endpoint (testnet: chain ID 10143, mainnet: chain ID 143)
- Deployer account with sufficient MON for gas + reserve balance

### 12.2 Deployment Script

```solidity
// script/Deploy.sol
contract DeployScript is Script {
    function run() external {
        vm.startBroadcast();
        new Monoracle();
        vm.stopBroadcast();
    }
}
```

### 12.3 Verification

```bash
forge verify-contract <address> Monoracle \
  --chain 10143 \
  --verifier sourcify \
  --verifier-url https://sourcify.dev/server
```

---

## 13. File Structure

```
monoracle/
├── contracts/
│   └── Monoracle.sol       # Core oracle contract
├── test/
│   └── Monoracle.t.sol     # Foundry test suite
├── script/
│   └── Deploy.sol           # Deployment script
├── lib/                     # Git submodules (forge install)
│   └── openzeppelin-contracts/
├── foundry.toml             # Foundry configuration
├── requirement.md           # Requirements document
├── tech-spec.md             # This file
└── README.md
```

# Monoracle

A fully permissionless, game-theoretic on-chain price oracle for the Monad blockchain. Price accuracy is enforced by economic incentives and on-chain arbitrage — no validators, no off-chain data feeds.

## How It Works

Every price quote is backed by bilateral collateral locked in an on-chain staking contract. During a 2-block verification window, any market participant can profitably veto an incorrect price by arbitraging against the locked collateral. Quotes that survive the window are confirmed as valid canonical prices.

1. **Submit** — Provider deposits base + quote token collateral and states a price
2. **Verify** — 2-block window for anyone to inspect the quote
3. **Veto** — If the quote is off-market, a verifier arbitrages the collateral for profit
4. **Settle** — If no veto occurs, the price is canonical and providers withdraw

## Contract

| | |
|---|---|
| **File** | `contracts/Monoracle.sol` |
| **Solidity** | `^0.8.20` |
| **Dependencies** | OpenZeppelin v5 (`SafeERC20`, `ReentrancyGuard`) |
| **Design** | Fully immutable — no upgrade, no owner, no admin |

### Deploy

```bash
npx hardhat run script/deploy.js --network monadTestnet
```

### Verify (Sourcify via BlockVision)

```bash
npx hardhat verify --network monadTestnet <address>
```

### Test

```bash
npx hardhat test
```

## Frontend

Next.js 16 dashboard in `web/`:

```bash
cd web
npx next dev -p 3000
```

## Network

| Network | Chain ID | RPC |
|---|---|---|
| Monad Testnet | 10143 | `https://testnet-rpc.monad.xyz` |
| Monad Mainnet | 143 | `https://rpc.monad.xyz` |

## Project Structure

```
monoracle/
├── contracts/
│   ├── Monoracle.sol          # Core oracle contract
│   └── MockERC20.sol          # Test ERC20 token
├── test/
│   └── Monoracle.test.js      # Foundry test suite
├── script/
│   ├── deploy.js              # Deployment script
│   └── smoke-test.js          # Post-deploy smoke test
├── web/                       # Next.js frontend
│   └── src/
│       ├── app/               # Next.js App Router pages
│       └── lib/               # Shared utilities (wagmi config, etc.)
├── hardhat.config.js
├── requirement.md             # Software requirements document
└── tech-spec.md               # Technical specification
```

# Monoracle

A fully permissionless, game-theoretic on-chain price oracle for the Monad blockchain. Price accuracy is enforced by economic incentives and on-chain arbitrage — no validators, no off-chain data feeds.

**AI Agent Native** — Monoracle is designed for AI agents to continuously optimize their arbitrage strategies, directly profit from price corrections, and collectively improve price accuracy over time.

## How It Works

Every price quote is backed by bilateral collateral locked in an on-chain staking contract. During a 2-block verification window, any market participant can profitably veto an incorrect price by arbitraging against the locked collateral. Quotes that survive the window are confirmed as valid canonical prices.

1. **Submit** — Provider deposits base + quote token collateral and states a price
2. **Verify** — 2-block window for anyone to inspect the quote
3. **Veto** — If the quote is off-market, a verifier arbitrages the collateral for profit
4. **Settle** — If no veto occurs, the price is canonical and providers withdraw

Because the veto logic is a pure on-chain game, **AI agents** can run sophisticated arbitrage bots that optimize execution strategies, manage gas costs, and adapt to changing market conditions — turning price correction into a profitable, self-improving system.

## Who Needs This

**PropAMM (Proportional Automated Market Maker)** — AMMs that adjust swap ratios proportionally based on real-time price feeds. Every millisecond of price delay means trades execute at stale rates. Monoracle's 600ms verification window (2 blocks at 300ms) is the only oracle fast enough to keep PropAMM pricing fair.

**On-chain market making programs** — Automated market makers that continuously quote two-sided orders need sub-block price updates. With Monoracle, they get a fresh canonical price every 2 blocks with economic finality — no off-chain relayers, no stale data.

**On-chain arbitrageurs** — Arbitrage bots need the fastest possible price signal to identify and execute profitable trades. Monoracle's permissionless veto mechanism lets them profit directly from price corrections, turning latency into a business model.

All three share the same requirement: **a price oracle that resolves in under a second, with no off-chain dependency, and economic guarantees that the price is honest.**

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.10
- A wallet with Monad testnet MON (get from [Monad faucet](https://testnet.monad.xyz))

### 1. Smart Contract

```bash
# Install Hardhat dependencies
cd monoracle
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Monad testnet
export PRIVATE_KEY=0x_your_key
npx hardhat run script/deploy.js --network monadTestnet

# Smoke test after deploy
npx hardhat run script/smoke-test.js --network monadTestnet

# Verify on Sourcify (BlockVision)
npx hardhat verify --network monadTestnet <deployed_address>
```

| | |
|---|---|
| **Contract** | `contracts/Monoracle.sol` |
| **Solidity** | `^0.8.20` |
| **Dependencies** | OpenZeppelin v5 (`SafeERC20`, `ReentrancyGuard`) |
| **Design** | Fully immutable — no upgrade, no owner, no admin |

### 2. Veto Bot (Python)

```bash
# Install Python dependencies
cd bot
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env:
#   PRIVATE_KEY=0x_your_verifier_wallet_key
#   ORACLE_ADDRESS=<deployed_contract_address>

# Run the bot
python verifier.py
```

The bot monitors `QuoteSubmitted` events via WebSocket, compares prices against `FAIR_PRICES`, and automatically vetoes mispriced quotes within the 600ms verification window.

### 3. Frontend

```bash
# Install and run the Next.js dashboard
cd web
npm install
npx next dev -p 3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Connect MetaMask (Monad testnet) to submit quotes and read canonical prices.

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
│   └── Monoracle.test.js      # Hardhat test suite
├── script/
│   ├── deploy.js              # Deployment script
│   └── smoke-test.js          # Post-deploy smoke test
├── bot/
│   ├── verifier.py             # Veto arbitrage bot (WebSocket + auto-veto)
│   ├── requirements.txt       # Python dependencies
│   └── .env.example           # Bot configuration template
├── web/                       # Next.js frontend
│   └── src/
│       ├── app/               # Next.js App Router pages
│       └── lib/               # Shared utilities (wagmi config, etc.)
├── hardhat.config.js
├── requirement.md             # Software requirements document
└── tech-spec.md               # Technical specification
```

---

# 中文

## 简介

**Monoracle** 是一个完全无许可、基于博弈论的链上价格预言机，部署在 Monad 区块链上。价格准确性由经济激励和链上套利保证——无需验证节点，没有链下数据源。

**AI 代理原生** — Monoracle 专为 AI 代理设计，使其能够持续优化套利策略，直接从价格修正中获利，并共同提升价格准确性。

## 运作原理

每笔报价由锁定在链上质押合约中的双边抵押品担保。在 2 个块的验证窗口内，任何市场参与者都可以通过对抵押品进行套利来否决错误报价，从而获利。存活下来的报价被确认为标准价格。

1. **提交** — 报价方存入基础代币 + 报价代币抵押品，声明价格
2. **验证** — 2 个块的窗口，任何人都可检查报价
3. **否决** — 若报价偏离市场，验证者套利抵押品获利
4. **结算** — 若无人否决，价格成为标准，报价方提取抵押品

由于否决逻辑完全在链上进行，**AI 代理**可以运行复杂的套利机器人，优化执行策略、管理 gas 成本并适应不断变化的市场条件——将价格修正转变为一个可盈利、自我改进的系统。

## 快速开始

### 前置条件

- **Node.js** ≥ 18
- **Python** ≥ 3.10
- 一个持有 Monad 测试网 MON 的钱包（可通过 [Monad 水龙头](https://testnet.monad.xyz) 获取）

### 1. 智能合约

```bash
# 安装 Hardhat 依赖
cd monoracle
npm install

# 编译合约
npx hardhat compile

# 运行测试
npx hardhat test

# 部署到 Monad 测试网
export PRIVATE_KEY=0x_your_key
npx hardhat run script/deploy.js --network monadTestnet

# 部署后冒烟测试
npx hardhat run script/smoke-test.js --network monadTestnet

# 在 Sourcify 上验证（BlockVision）
npx hardhat verify --network monadTestnet <deployed_address>
```

| | |
|---|---|
| **合约** | `contracts/Monoracle.sol` |
| **Solidity** | `^0.8.20` |
| **依赖** | OpenZeppelin v5（`SafeERC20`、`ReentrancyGuard`） |
| **设计** | 完全不可变——无升级、无所有者、无管理员 |

### 2. 否决机器人（Python）

```bash
# 安装 Python 依赖
cd bot
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env：
#   PRIVATE_KEY=0x_your_verifier_wallet_key
#   ORACLE_ADDRESS=<deployed_contract_address>

# 运行机器人
python verifier.py
```

机器人通过 WebSocket 监听 `QuoteSubmitted` 事件，将报价与 `FAIR_PRICES` 进行比较，在 600ms 验证窗口内自动否决错误报价。

### 3. 前端

```bash
# 安装并启动 Next.js 仪表盘
cd web
npm install
npx next dev -p 3000
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000)，连接 MetaMask（Monad 测试网），即可提交报价和查询标准价格。

## 网络

| 网络 | 链 ID | RPC |
|---|---|---|
| Monad 测试网 | 10143 | `https://testnet-rpc.monad.xyz` |
| Monad 主网 | 143 | `https://rpc.monad.xyz` |

## 项目结构

```
monoracle/
├── contracts/
│   ├── Monoracle.sol          # 核心预言机合约
│   └── MockERC20.sol          # 测试用 ERC20 代币
├── test/
│   └── Monoracle.test.js      # Hardhat 测试套件
├── script/
│   ├── deploy.js              # 部署脚本
│   └── smoke-test.js          # 部署后冒烟测试
├── bot/
│   ├── verifier.py             # 否决套利机器人（WebSocket + 自动否决）
│   ├── requirements.txt       # Python 依赖
│   └── .env.example           # 机器人配置模板
├── web/                       # Next.js 前端
│   └── src/
│       ├── app/               # Next.js App Router 页面
│       └── lib/               # 共享工具（wagmi 配置等）
├── hardhat.config.js
├── requirement.md             # 软件需求文档
└── tech-spec.md               # 技术规格文档
```

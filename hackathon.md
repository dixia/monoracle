# Monoracle

**Monad Blitz@武汉 — Submission**

---

## English

### One-Liner

A fully permissionless, game-theoretic on-chain price oracle on Monad — no validators, no off-chain data feeds, just economic incentives and on-chain arbitrage.

### Problem

Existing on-chain oracles (Chainlink, Pyth) rely on off-chain relayers, staked validator sets, or trusted hardware. This creates:
- **Centralization risk** — a handful of nodes control price feeds
- **Liveness dependency** — if relayers go down, prices freeze
- **Latency overhead** — data must travel off-chain → on-chain

### Solution

Monoracle is a **self-correcting oracle** where every price quote is backed by bilateral collateral locked in an on-chain staking contract. During a 2-block verification window, any market participant can profitably veto an incorrect price by arbitraging against the locked collateral. Quotes that survive the window are confirmed as valid canonical prices.

#### How It Works

1. **Submit** — A provider deposits base + quote token collateral and states a price (e.g. `MON/USDC = 100`)
2. **Verify** — For 2 blocks, anyone can inspect the quote
3. **Veto (if wrong)** — If the quote is off-market, a verifier arbitrages against the collateral:
   - **Underpriced quote** → Verifier pays quote tokens, receives underpriced base tokens, sells them on secondary market for profit
   - **Overpriced quote** → Verifier pays base tokens, receives overpriced quote tokens, profits from the spread
4. **Settle** — If no veto occurs, the price is canonical and providers withdraw collateral + fees

Price accuracy is guaranteed by **profitable arbitrage**, not by trust.

### Why Monad

- **400ms block time + 800ms finality** — enables the 2-block verification window to resolve in under 1 second
- **Parallel execution** — multiple quotes, vetoes, and settlements can be processed simultaneously without contention
- **128kb contract size limit** — allows all oracle logic in a single immutable contract
- **`eth_sendRawTransactionSync`** — verifiers can submit veto transactions and know the result in the same block, critical for arbitrage profitability

### Tech Stack

- **Solidity ^0.8.20** — Smart contract (ReentrancyGuard, custom access control)
- **Hardhat** — Development, testing, deployment
- **Next.js** — Frontend dashboard
- **Monad Testnet** — Deployment target

---

## 中文

### 一句话简介

Monad 上完全无许可、基于博弈论的链上价格预言机 —— 无需验证节点，没有链下数据源，仅靠经济激励和链上套利保证价格准确。

### 问题

现有的链上预言机（Chainlink、Pyth）依赖链下中继器、质押验证节点或可信硬件，导致：
- **中心化风险** — 少数节点控制价格输入
- **活性依赖** — 中继器下线则价格冻结
- **延迟开销** — 数据需经链下 → 链上传输

### 解决方案

Monoracle 是一个**自修正预言机**：每笔报价由锁定在链上质押合约中的双边抵押品担保。在 2 个块的验证窗口内，任何市场参与者都可以通过对锁定的抵押品进行套利来否决错误报价，从而获利。存活下来的报价被确认为有效标准价格。

#### 运作流程

1. **提交** — 报价方存入基础代币 + 报价代币抵押品，声明价格（如 `MON/USDC = 100`）
2. **验证** — 2 个块内，任何人可检查报价
3. **否决（若错误）** — 若报价偏离市场，验证者通过套利赚取差价：
   - **报价过低** → 验证者支付报价代币，获得被低估的基础代币，在二级市场卖出获利
   - **报价过高** → 验证者支付基础代币，获得被高估的报价代币，从价差中获利
4. **结算** — 若无否决，价格成为标准报价，报价方提取抵押品和费用

价格准确性由**可盈利的套利**保证，而非信任。

### 为什么选择 Monad

- **400ms 出块 + 800ms 最终确定性** — 2 个块的验证窗口在 1 秒内完成
- **并行执行** — 多笔报价、否决和结算可同时处理，互不竞争
- **128kb 合约大小限制** — 所有预言机逻辑可放入一个不可变合约
- **`eth_sendRawTransactionSync`** — 验证者可提交否决交易并在同一区块内获得结果，对套利盈利至关重要

### 技术栈

- **Solidity ^0.8.20** — 智能合约（ReentrancyGuard，自定义访问控制）
- **Hardhat** — 开发、测试、部署框架
- **Next.js** — 前端仪表盘
- **Monad Testnet** — 部署目标网络

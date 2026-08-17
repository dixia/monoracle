# Monoracle

**Monad Blitz@武汉 — Submission**

---

## English

### One-Liner

A fully permissionless, game-theoretic on-chain price oracle on Monad — no validators, no off-chain data feeds, just economic incentives and on-chain arbitrage. AI agent native — built for AI agents to continuously optimize arbitrage strategies and create a self-correcting price system.

### Problem

Existing on-chain oracles (Chainlink, Pyth) rely on off-chain relayers, staked validator sets, or trusted hardware. This creates:
- **High centralization risk** — a handful of nodes control price feeds, single point of failure
- **Latency overhead** — data must travel off-chain → on-chain, causing significant delays
- **Liveness dependency** — if relayers go down, prices freeze

**Who suffers most:** PropAMMs, on-chain market making programs, and arbitrage bots. These systems operate in sub-second timeframes — they can't wait for off-chain relayers. A PropAMM that swaps at stale prices loses to arbitrage. A market maker quoting two-sided orders needs the canonical price before the next block arrives. An arbitrageur needs the fastest honest price signal to decide which trades to execute.

### Solution

Monoracle is a **self-correcting oracle** where every price quote is backed by bilateral collateral locked in an on-chain staking contract. During a 2-block verification window, any market participant can profitably veto an incorrect price by arbitraging against the locked collateral. Quotes that survive the window are confirmed as valid canonical prices.

#### How It Works

1. **Submit** — A provider deposits base + quote token collateral × safety multiplier and states a price (e.g. `MON/USDC = 100`)
2. **Verify** — For 2 blocks, anyone can inspect the quote
3. **Veto (if wrong)** — If the quote is off-market, a verifier arbitrages against the collateral:
   - **Underpriced quote** → Verifier pays quote tokens, receives underpriced base tokens, sells them on secondary market for profit
   - **Overpriced quote** → Verifier pays base tokens, receives overpriced quote tokens, profits from the spread
4. **Settle** — If no veto occurs, the price is canonical and providers withdraw collateral + fees

Price accuracy is guaranteed by **profitable arbitrage**, not by trust.

**AI Agent Native** — Because the veto arbitrage is a pure on-chain game, AI agents can continuously optimize execution strategies (gas management, DEX routing, slippage modeling) to maximize profit from price corrections, creating a self-improving system.

### Why Monad

- **400ms block time + 800ms finality** — enables the 2-block verification window to resolve in under 1 second
- **128kb contract size limit** — allows all oracle logic in a single immutable contract
- **`eth_sendRawTransactionSync`** — verifiers can submit veto transactions and know the result in the same block, critical for arbitrage profitability
- **Low gas fees** — cheap on-chain costs enable frequent price games without gas costs eating into arbitrage profits

### Tech Stack

- **Solidity ^0.8.20** — Smart contract
- **Hardhat** — Development, testing, deployment
- **Python** — Verifier veto bot (`verifier.py`) with WebSocket event monitoring and automated arbitrage execution
- **Next.js** — Frontend dashboard
- **Monad Testnet** — Deployment target

---

## 中文

### 一句话简介

Monad 上的去中心化博弈式链上预言机 —— 不依赖验证节点，不需要链下数据源，完全由经济激励和链上套利驱动价格准确性。原生适配 AI 代理：AI 可持续优化套利策略，构建自我演化的价格系统。

### 问题

现有的链上预言机（Chainlink、Pyth）依赖链下中继器、质押验证节点或可信硬件，导致：
- **中心化风险** — 少数节点掌控价格输入，单点故障风险极高
- **延迟严重** — 数据需经链下→链上传输，响应缓慢
- **可用性脆弱** — 中继器一旦宕机，价格直接冻结

### 解决方案

Monoracle 是一个**自修正预言机**：每笔报价由锁定在链上质押合约中的双边抵押品担保。在 2 个块的验证窗口内，任何市场参与者都可以通过对锁定的抵押品进行套利来否决错误报价，从而获利。存活下来的报价被确认为有效标准价格。

#### 运作流程

1. **提交** — 报价方存入基础代币和报价代币（按安全基数乘算），声明价格（如 `MON/USDC = 100`）
2. **验证** — 2 个块内，任何人可检查报价
3. **否决（若错误）** — 若报价偏离市场，验证者通过套利赚取差价：
   - **报价过低** → 验证者支付报价代币，换取被低估的基础代币，在二级市场卖出获利
   - **报价过高** → 验证者支付基础代币，换取被高估的报价代币，赚取差价
4. **结算** — 若无否决，该价格即被采纳为基准价，报价方提取抵押品

价格准确性由**可盈利的套利**保证，而非信任。

**AI 代理原生** — 否决套利本质上是一个链上博弈。AI 代理可以持续优化执行策略——包括 gas 成本管理、DEX 路由选择、滑点建模——在价格纠错中不断获利，形成一个自我进化的系统。

### 为什么选择 Monad

- **400ms 出块 + 800ms 最终确定性** — 2 个块的验证窗口在 1 秒内完成
- **128kb 合约大小限制** — 所有预言机逻辑可放入一个不可变合约
- **`eth_sendRawTransactionSync`** — 验证者可提交否决交易并在同一区块内获得结果，对套利盈利至关重要
- **低 gas 费用** — gas 极便宜，使高频价格博弈成为可能，套利利润不会被手续费吞噬

### 技术栈

- **Solidity ^0.8.20** — 智能合约
- **Hardhat** — 开发、测试、部署框架
- **Python** — 验证者否决机器人（`verifier.py`），基于 WebSocket 实时监听事件并自动执行套利
- **Next.js** — 前端
- **Monad Testnet** — 部署目标网络

### Demo Frontend

https://web-p0ljqigz9-h-fbf5.vercel.app
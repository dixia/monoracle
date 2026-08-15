# Monoracle Veto Bot — PRD

## Flash-Loan-Powered Veto Bot (Zero-Collateral Verification)

**Status:** Proposed (roadmap FLB-01) — see `plan/roadmap.md`

Addresses the capital participation barrier (`product-analysis.md`): a veto currently requires the verifier to commit `quoteAmount`/`baseAmount` into escrow (`requirement.md:100`). A flash loan removes that commitment by executing veto + arbitrage + repayment as a single atomic transaction. See `product-analysis.md` for the product analysis.

### Requirements

- **FR-FLB-001**: The verifier bot shall be able to execute vetoes using a flash loan, so the verifier does not need to hold `quoteAmount`/`baseAmount` of idle collateral.
- **FR-FLB-002** (Underpriced): The bot shall flash-borrow `quoteAmount` of quote token, call `vetoUnderpriced(quoteId)` (receiving `baseAmount` base token), swap the received base token to quote token on a secondary Monad DEX within the same transaction, repay the flash loan plus fee, and retain any residual as profit.
- **FR-FLB-003** (Overpriced): The bot shall flash-borrow `baseAmount` of base token, call `vetoOverpriced(quoteId)` (receiving `quoteAmount` quote token), swap the received quote token to base token on a secondary Monad DEX within the same transaction, repay the flash loan plus fee, and retain any residual as profit.
- **FR-FLB-004**: The flash-loan flow shall be atomic — the veto call, the DEX swap(s), and the loan repayment must happen in a single on-chain transaction. The entire transaction shall revert (leaving no state change) if the swap proceeds cannot repay the loan plus fee.
- **FR-FLB-005**: The bot shall be configurable via env vars (`FLASH_LOAN_ENABLED`, `FLASH_LOAN_PROVIDER`, `DEX_ROUTER`, `FLASH_LOAN_FEE_BPS`). When disabled, the bot shall fall back to the current self-funded veto path in `bot/verifier.py`.
- **FR-FLB-006**: The profit gate (`min_bps` break-even) shall include the flash-loan fee and estimated DEX slippage in addition to gas cost when flash-loan mode is enabled.
- **FR-FLB-007**: On-chain veto logic is unchanged (`vetoUnderpriced`/`vetoOverpriced` remain permissionless and identical); the flash loan is purely a bot-side capital strategy and requires no change to `Monoracle.sol`.
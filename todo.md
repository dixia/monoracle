# Monoracle — Task Tracker

## Done
- [x] Requirements doc (merged 3 versions, validated against Monad docs)
- [x] Tech spec with full API, gas estimates, Monad-specific notes
- [x] Smart contract `Monoracle.sol` — bilateral collateral + veto arbitrage
- [x] Contract compiled & verified (Hardhat + Solidity 0.8.20)
- [x] Contract deployed to Monad testnet
- [x] Verified on Sourcify
- [x] Next.js dapp frontend built (static export to `web/out/`)

## In Progress
- [x] Rename contract GiroOracle → Monoracle + redeploy
- [x] Update frontend with new contract address
- [x] Deploy frontend to EC2 (or Vercel after GitHub push)

## Remaining
- [x] Push repo to GitHub
- [x] Connect Vercel to GitHub repo for auto-deploy (or deploy to EC2)
- [ ] Create `.monskills` metadata file (done)
- [ ] **Optional / deferred:** On `withdrawProviderFunds`, `delete quotes[quoteId]` (or zero non-essential fields) after `SETTLED_WITHDRAWN` for gas refund — FR-SV-009 says storage *may* be cleared; v1 keeps full struct for permanent audit via public `quotes` mapping (FR-PF-003). Trade-off: slightly higher long-term storage vs cheaper withdraw + lost history unless events-only audit.
- [x] **Cleanup:** Remove unused custom error `InvalidQuoteStatus` from `Monoracle.sol` (withdraw uses `NotWithdrawable` / `NotQuoteProvider` instead).


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
- [ ] Update frontend with new contract address
- [ ] Deploy frontend to EC2 (or Vercel after GitHub push)

## Remaining
- [ ] Push repo to GitHub
- [ ] Connect Vercel to GitHub repo for auto-deploy (or deploy to EC2)
- [ ] Take screenshots of live dapp
- [ ] Register agent on Mojo: `POST https://mojo.devnads.com/api/agent/register`
- [ ] User claims agent via claimUrl
- [ ] Upload screenshots to Mojo (3-step: request → PUT S3 → confirm)
- [ ] Submit project: `POST https://mojo.devnads.com/api/agent/projects` with eventId=13
- [ ] Create `.monskills` metadata file (done)

## Mojo Submission Info (to fill)
- **Project name:** Monoracle
- **Description:** TBD
- **Demo URL:** TBD (after deploy)
- **GitHub:** TBD (after push)
- **Screenshots:** TBD (after deploy)

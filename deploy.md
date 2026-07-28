# Monoracle — Deployment & Release Workflow

## Remote setup

| Remote | URL | Purpose |
|---|---|---|
| **`origin`** | `https://github.com/dixia/monoracle-dev.git` | Private repo — daily development |
| **`public`** | `https://github.com/dixia/monoracle.git` | Public repo — selective releases |

## Daily development (private)

```bash
# Everything you do goes to private by default:
git add . && git commit -m "..." && git push
```

## Releasing changes to public

```bash
# When you want to release changes to public:
git checkout -b release/v0.3.0
git cherry-pick <commit-hash>   # pick only what you want to share
git push public release/v0.3.0:main
```

## Deploy contracts

### Prerequisites

- `.env` file with `PRIVATE_KEY` (with MON testnet balance)
- Optionally set `RPC_URL` and `CHAIN_ID` (defaults: Monad testnet)

### 1. Deploy mock tokens

```bash
node script/deploy-tokens.js
```

Prints BASE and QUOTE token addresses. Note them for the next step.

### 2. Deploy Monoracle

```bash
node script/deploy.js
```

Saves deployment info to `deployment.json` (gitignored).

### 3. Configure environment

Set the new addresses in:

| File | Env vars |
|---|---|
| `.env` | `ORACLE_ADDRESS`, `BASE_TOKEN`, `QUOTE_TOKEN` |
| `bot/.env` | `ORACLE_ADDRESS`, `MONITORED_PAIRS` |
| `web/.env.local` | `NEXT_PUBLIC_ORACLE_ADDRESS`, `NEXT_PUBLIC_BASE_TOKEN`, `NEXT_PUBLIC_QUOTE_TOKEN` |
| Vercel dashboard | Same `NEXT_PUBLIC_*` vars |

### 4. Verify

```bash
npx hardhat test
```

## Vercel (private frontend)

Create a separate Vercel project linked to `monoracle-dev`. Set `NEXT_PUBLIC_*` env vars in the dashboard. No `vercel.json` needed — the build uses `output: "export"`.

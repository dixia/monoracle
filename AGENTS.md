<!-- BEGIN:workflow-rules -->
# Workflow Rules

## Push policy
Do not ask the user whether to push. Push changes only when user asked and approved.
<!-- END:workflow-rules -->

## Monad Reference Docs

For Monad-specific details (architecture, async/parallel execution, gas model,
block states, tooling), consult the full LLM-friendly
Monad docs index: https://docs.monad.xyz/llms-full.txt

## GitHub CLI (gh) Configuration

A classic GitHub PAT with `repo` + `read:org` scopes is configured for the `gh`
CLI tool (account `dixia`).

## Repositories

This project has **three** repositories:

| Repo | Visibility | Remote | URL |
|------|-----------|--------|-----|
| monoracle-dev | Private | `origin` | `github.com/dixia/monoracle-dev.git` |
| monoracle | Public | `public` | `github.com/dixia/monoracle.git` |
| IRMarket | Public | — | `github.com/dixia/IRMarket.git` (GTM subproject) |

- **Internal workflow rules:** `.internal/workflow.md`

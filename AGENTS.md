<!-- BEGIN:workflow-rules -->
# Workflow Rules

## Push policy
Do not ask the user whether to push. Push changes when appropriate and expected, without asking.
<!-- END:workflow-rules -->

## GitHub CLI (gh) Configuration

A classic GitHub PAT with `repo` + `read:org` scopes is configured for the `gh`
CLI tool (account `dixia`).

| Operation | Scope |
|-----------|-------|
| `gh issue create / close` | public & private repos |
| `gh pr create / list` | public & private repos |
| `gh repo view` | public & private repos |
| `git push` (via https) | remote repos |

### Quick Reference

```powershell
# Create issue with body from stdin (avoids quoting issues)
echo "body" | gh issue create --repo owner/repo --title "Title" --body-file -

# Create PR
gh pr create --repo owner/repo --title "Title" --body "Body"

# List issues
gh issue list --repo owner/repo --limit 10

## Repositories

This project has **two** repositories:

| Repo | Visibility | Remote | URL |
|------|-----------|--------|-----|
| monoracle-dev | Private | `origin` | `github.com/dixia/monoracle-dev.git` |
| monoracle | Public | `public` | `github.com/dixia/monoracle.git` |
| IRMarket | Public | — | `github.com/dixia/IRMarket.git` (GTM subproject) |

- **Private repo (origin):** Daily development, all commits, branch work. Default push target.
- **Public repo (public):** Selective cherry-picks only. Push with `git push public <branch>`.
- **IRMarket (subproject):** Exotic-option GTM demo of the Monoracle primitive; live at
  `irmarket-h-fbf5.vercel.app`. See `docs/workflow.md` §Subprojects.

Sync back to public is **manual cherry-pick** — never force-push to public.

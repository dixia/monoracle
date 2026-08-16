# Workflow: Harvesting Downstream Requirements from Subprojects

When a subproject (e.g. IRMarket) forks/extends this repo, capture the changes as
tracked requirements instead of letting them live only in the subproject.

## Steps

1. **Identify the change axes** — diff subproject vs upstream across
   contracts / bot / scripts / docs (`git diff --no-index <upstream> <subproject>`).
2. **Classify each change:**
   - Behavioral contract change → may already be specced here (grep `requirement.md`
     for `FR-*`) → if yes, file as DOWNSTREAM IMPLEMENTATION issue referencing the FR.
   - Bot/library infra → separate "functionality" (role features) from reusable
     infra (nonce tracking, gas caps, tx-confirm patterns).
   - Subproject-only artifacts (UI, deployment scripts, market factory) → usually DROP.
3. **Triage with the user:** which changes become requirements, which are skipped.
4. **Create GitHub issues** in `dixia/monoracle-dev` (NOT local `plan/roadmap.md`):
   - Body: summary, spec refs / reference impl paths, checkbox milestones,
     explicit "NOT porting" scope.
   - `echo "body" | gh issue create --repo dixia/monoracle-dev --title ... --body-file -`
5. **Update coordination docs**: `docs/workflow.md` §Subprojects + `AGENTS.md` repo table
   with a link from each issue to its subproject source.

## Rules

- GitHub Issues preferred over Projects — token lacks `project` scope.
- Subproject secrets (`.mojo-agent.json`, API keys) stay gitignored, never referenced in issues.
- Company-only work goes on the private dev repo (origin).
# Workflow: Updating the DeltaV Startup Form with Edge

The Monoracle startup profile lives at https://deltav.monad.xyz/startup-form and is behind a
Privy login. This workflow uses the **Edge browser MCP** (`edge` server in opencode config,
running Playwright with the `msedge` channel) to fill/update it, never submitting until review.

## Prerequisites

- opencode has the `edge` MCP server enabled (global config: `~/.config/opencode/opencode.json`).
- The user is signed in to DeltaV in the Playwright-controlled Edge session.
  DeltaV uses a magic-link (email) login via Privy — log in manually in the opened window.

## Steps

1. **Navigate**
   ```
   edge_browser_navigate  url=https://deltav.monad.xyz/startup-form
   ```
   If a login modal appears, sign in; then the form loads. If an existing profile exists,
   the form may open in a "review" state.

2. **Survey the form**
   ```
   edge_browser_snapshot
   ```
   The form is a 10-section wizard: Basics → Idea → Problem & Solution → Product & Tech →
   Market → Traction → Fundraising → Team → Links → Analytics. Nav buttons and refs change per
   snapshot, so always re-snapshot before interacting.

3. **Fill each section**
   - Text fields: `edge_browser_fill_form` (batch several fields per call).
   - Buttons / option pills (Verticals, Stage, etc.): `edge_browser_click`, then confirm via
     `edge_browser_evaluate` (selected pills carry `bg-accent`).
   - Dropdowns (City, Chain): `edge_browser_click` to open, `edge_browser_find` for the option,
     `edge_browser_click` the option, then `Esc`.
   - Date fields: month inputs take `YYYY-MM` (e.g. `2026-07`).
   - File uploads (logo/banner): not supported headless; leave blank and note in the doc.

4. **Navigate sections** via the `Next`/`Previous` buttons (or the section nav buttons).

5. **Do NOT submit** — leave on the final step. The user reviews and clicks **Save Profile**
   themselves.

## Source of truth

- Fill content from this repo: `docs/startup-form.md` (the saved profile snapshot),
  `README.md`, `hackathon.md`, `most-application.md`, `deploy.md`/`deployment.json`
  (current contract address), `plan/roadmap.md`.
- After any update, mirror the change back into `docs/startup-form.md` so it stays the
  canonical record.

## Security notes

- `docs/startup-form.md` and `docs/DELTAV_API_KEY.md` are gitignored — never commit them,
  and never paste the API key into chat/logs.
- The **weekly-updates API** (twitter-style posts, not the startup form) uses the key in
  `docs/DELTAV_API_KEY.md` against `https://deltav.monad.xyz/api/v1/weekly-updates`.
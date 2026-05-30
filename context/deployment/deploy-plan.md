---
project: MovieMate
plan: First Cloudflare Workers deploy
created_at: 2026-05-29
recommended_platform: Cloudflare (Workers static-assets)
overview: Ship MovieMate's first production deploy to Cloudflare Workers static-assets via wrangler, rename the Worker to "moviemate", wire runtime secrets, then connect the GitHub repo to Cloudflare Workers Builds for auto-deploy-on-merge.
tech_stack:
  language: TypeScript
  framework: Astro + React
  runtime: Cloudflare workerd
---

# First Cloudflare Workers Deploy

Deploy MovieMate to **Cloudflare Workers static-assets** per [infrastructure.md](../foundation/infrastructure.md), on the stack from [tech-stack.md](../foundation/tech-stack.md). The repo is already Workers-targeted ([wrangler.jsonc](../../wrangler.jsonc) has `main` + `assets`), so no Pages migration is needed.

## Current State (verified)

- `wrangler 4.90.0` installed; adapter `@astrojs/cloudflare 13.5.0`, `astro 6.3.1` (the doc's "beta" caveat is stale for today).
- [wrangler.jsonc](../../wrangler.jsonc): name `"moviemate"`, `nodejs_compat`, observability on.
- `deploy` script: `astro build && wrangler deploy` in [package.json](../../package.json).
- `.dev.vars` created from `.env` (gitignored); local build reads Supabase secrets.
- CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) only lints+builds — no deploy step yet.
- Secrets in scope: `SUPABASE_URL`, `SUPABASE_KEY` only (declared server-secret in [astro.config.mjs](../../astro.config.mjs)). No TMDB/AI keys (features not built).

## Execution log (2026-05-30)

| Step | Status | Notes |
| --- | --- | --- |
| 1 Rename Worker | done | `moviemate` in wrangler.jsonc |
| 2 Deploy script | done | `npm run deploy` |
| 3 Local `.dev.vars` | done | copied from `.env` |
| 4 `wrangler login` | done | OAuth (wojciechderlikiewicz@gmail.com) |
| 5 Production secrets | done | `SUPABASE_URL`, `SUPABASE_KEY` on Worker `moviemate` |
| 6 First deploy | done | **https://moviemate.wojciechderlikiewicz.workers.dev** — version `6b1d6993-b2f7-4876-a04a-17eaf2335179` |
| 7 Verify (`wrangler tail`, rollback note) | done | HTTP 200 on `/` and `/auth/signin`; rollback: `npx wrangler rollback <version-id>` after `npx wrangler versions list` |
| 8 Workers Builds (Git) | pending | dashboard manual gate — see step 8 below |

## Steps

### 1. Rename the Worker (agent edit)
In [wrangler.jsonc](../../wrangler.jsonc): `"name": "10x-astro-starter"` -> `"name": "moviemate"`.

### 2. Add a deploy script (agent edit)
In [package.json](../../package.json) scripts: add `"deploy": "astro build && wrangler deploy"` so build always precedes deploy (`wrangler deploy` does not build Astro).

### 3. Local dev secrets (agent edit, gitignored)
Create `.dev.vars` (already in [.gitignore](../../.gitignore)) from current `.env` values so `astro dev`/local wrangler can read them. Never commit it.

### 4. Cloudflare login [MANUAL GATE]
You run `npx wrangler login` (browser OAuth) — agent cannot complete OAuth. Confirms account + creates the Worker namespace.

### 5. Set production runtime secrets [MANUAL GATE]
Push secrets to the deployed Worker (read at runtime via `astro:env`, never at build):

```
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Agent can run these but they require the authenticated session from step 4; you paste the values when prompted. Use the values currently in `.env`.

### 6. Build and first deploy (agent runs after gates)
```
npm run deploy
```
Builds via the Cloudflare adapter, then uploads to Workers. Outputs the live `*.workers.dev` URL.

### 7. Verify the ops loop (agent runs)
- `npx wrangler tail` — confirm live runtime logs on a request to the deployed URL.
- Note rollback command for the runbook: `npx wrangler rollback [version-id]` (last 100 versions; `npx wrangler versions list` to find IDs).

### 8. Auto-deploy-on-merge via Cloudflare Workers Builds [MANUAL GATE]
Per the chosen approach, use Cloudflare's native Git integration (not a GitHub Action — avoids storing a CF API token in GitHub):
- In the Cloudflare dashboard: Workers & Pages -> `moviemate` -> Settings -> Builds -> Connect to Git, select this GitHub repo, branch **`main`** (default branch on `origin`; not `master`).
- Build command: `npm run build`; Deploy command: `npx wrangler deploy`; Root dir: repo root.
- Add `SUPABASE_URL` / `SUPABASE_KEY` as Build environment variables/secrets in the dashboard so CI builds resolve env.
- This is dashboard-only (one-time); the agent will give you the exact field values to paste.

## Notes / Risks
- The existing [.github/workflows/ci.yml](../../.github/workflows/ci.yml) stays as the lint+build gate; Cloudflare Workers Builds handles deploy. No GitHub Action deploy step added.
- `.nvmrc` pins Node 22.14.0; local Node is v24 — fine for wrangler, but Workers Builds should pin Node 22 to match CI.
- Subrequest/CPU free-tier caps and the `<10s` NFR (risk register) only bite once TMDB + AI calls land; not relevant to this static/auth-only first deploy.
- Out of scope: TMDB/AI key provisioning, Supabase migrations.
- **Supabase Auth (production):** dashboard **Site URL** must match the Workers URL (not `localhost`); allow redirect `https://<workers-host>/auth/callback`. Code sets `emailRedirectTo` on sign-up; `/auth/callback` exchanges `?code=` for a session.

---
project: MovieMate
researched_at: 2026-05-29
recommended_platform: Cloudflare (Workers + Pages)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro + React
  runtime: Cloudflare workerd
---

## Recommendation

**Deploy on Cloudflare (Workers + Pages) — targeting Workers static-assets, not legacy Pages.**

Cloudflare is the only candidate that scores Pass on all five agent-friendly criteria *and* costs $0 at MovieMate's scale (free tier covers 100k requests/day; you'll serve far less), with no egress fees. It is also the native deployment target the `10x-astro-starter` already declares, so the adapter, `astro:env` secret handling, and CI auto-deploy-on-merge are pre-wired. The cost-minimization priority (interview Q2) decisively favors it over Vercel (commercial use forces a $20/mo Pro plan), Railway and Fly.io (no free tier). The anti-bias cross-check did not unseat it but reshaped the recommendation: **deploy to Workers static-assets rather than the soft-sunset Pages product, and pin the GA adapter/Astro line rather than the Astro 6 beta.**

## Platform Comparison

Scored Pass / Partial / Fail against the five agent-friendly criteria. Hard filter applied: interview Q1 = "no persistent connections", so no platform was dropped for serverless-only constraints. Tech stack (Astro/React/TS) runs on every candidate via the appropriate adapter, so no platform was dropped on runtime grounds.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare | Pass\* | Pass | Pass | Pass | Pass (GA) | 5 Pass |
| Vercel | Pass | Pass | Pass | Pass | Pass (GA) | 5 Pass |
| Netlify | Partial | Pass | Pass | Pass | Pass (GA) | 4 Pass / 1 Partial |
| Render | Partial | Pass | Pass | Pass | Pass (GA) | 4 Pass / 1 Partial |
| Railway | Partial | Pass | Pass | Pass | Partial (beta) | 3 Pass / 2 Partial |
| Fly.io | Partial | Partial | Pass | Pass | Partial (beta) | 2 Pass / 3 Partial |

\* Cloudflare CLI: Workers `wrangler deploy` / `wrangler rollback` / `wrangler tail` are clean and GA; **Pages rollback is dashboard-only** — the single reason it isn't an unqualified Pass, and a driver of the "deploy to Workers" recommendation.

**Per-platform notes (all checked 2026-05-29):**

- **Cloudflare** — `wrangler 4` (GA): `wrangler deploy`, `wrangler rollback [version]` (last 100 versions), `wrangler tail`. Docs are GitHub markdown + `llms.txt`. Free: 100k req/day, 10ms CPU/invocation; paid $5/mo lifts CPU caps (not request count); no egress fees. WebSockets only via Durable Objects (irrelevant — stateless app). GA remote MCP servers (Docs, Workers Bindings, Observability) usable from Cursor/Claude. Caveat: Cloudflare steers new SSR apps to **Workers static-assets**; Pages and Workers `wrangler` subcommands are **not interchangeable**.
- **Vercel** — `@astrojs/vercel` v10 (GA; v9→v10 was a breaking entrypoint change, needs Astro ≥6.1.8). Cleanest ops: instant `vercel rollback`, `vercel logs --follow`. Hobby free tier easily covers 10k–100k req/mo but is **non-commercial only** — revenue use requires Pro at $20/user/mo. GA Vercel MCP. No WebSockets. Lost to Cloudflare purely on the commercial-use cost cliff.
- **Netlify** — `@astrojs/netlify` v7 (GA). `netlify deploy` is draft-by-default (`--prod` required); `netlify logs` GA (added May 2026); **no rollback CLI** (dashboard only). Free tier = 300 credits/mo, no cold starts. Official Netlify MCP Server GA. Risk: **10s function timeout on free** (26s Pro) brushes the "<10s recommendations" NFR given TMDB + AI calls.
- **Render** — Astro as a Node Web Service via `@astrojs/node` (GA). `render deploys create`, `render logs`; **rollback via dashboard/API, not CLI**. Free tier spins down after 15min → **30–60s cold start**; $7/mo Starter for always-on. GA hosted Render MCP. Flat pricing (not request-metered).
- **Railway** — Astro SSR via `@astrojs/node` + Nixpacks/Railpack (Railpack beta). `railway up` / `railway logs` / `railway redeploy`; **rollback dashboard-only**. **No free tier** (removed 2023); $5/mo Hobby minimum. MCP + `railway agent` in public testing (beta).
- **Fly.io** — Astro `@astrojs/node` standalone in a Docker container; `fly launch` auto-generates Dockerfile. `fly deploy`, `fly logs`; **no rollback command** (redeploy prior image tag). **No free tier**; pay-as-you-go ~$2–6/mo always-on. MCP tooling mostly beta/experimental. Container builds slower; scale-to-zero adds cold starts.

### Shortlisted Platforms

#### 1. Cloudflare (Recommended)

Only 5/5-Pass platform that is also genuinely free at this scale, with no egress fees and GA MCP servers for agent-driven ops. It is the stack's declared target, so secret handling (`astro:env`), the adapter, and CI auto-deploy are already configured. Deploy to **Workers static-assets** and pin the GA adapter/Astro line to dodge the cross-check risks.

#### 2. Vercel

Tied 5/5 on criteria and has the best rollback ergonomics of any candidate (`vercel rollback` is instant and scriptable). The gap vs. Cloudflare is cost under the cost-minimization priority: the free Hobby tier is non-commercial, so any monetization pushes MovieMate to $20/mo Pro. A strong fallback if Cloudflare's workerd constraints prove painful.

#### 3. Netlify

Serverless with no cold starts, GA MCP, and excellent agent-readable docs (`llms.txt`). Falls to third on two counts: no CLI rollback (dashboard step breaks the unattended agent loop) and a 10s free-tier function timeout that directly threatens the "<10s" recommendation NFR once TMDB retrieval and AI justification run server-side.

## Anti-Bias Cross-Check: Cloudflare

### Devil's Advocate — Weaknesses

1. **Pages vs Workers split.** The starter targets `cloudflare-pages`, but Cloudflare now routes new SSR apps to Workers static-assets, and **Pages rollback is dashboard-only** — the agent-driven terminal rollback loop breaks on the exact product the starter picked.
2. **Adapter / Astro version churn.** `@astrojs/cloudflare` v13 pairs with **Astro 6 (beta)**; the GA path is v11/Astro 5. Breaking changes (env via `cloudflare:workers`, moved entrypoint) mean older tutorials generate wrong config.
3. **workerd ≠ Node.** Supabase SSR client, TMDB fetch, and AI SDKs must use Web-standard APIs; Node-only deps fail **only at runtime**, and older adapters don't mirror workerd in `astro dev`, so bugs surface after deploy.
4. **Free-plan limiter is subrequests/CPU, not request count.** TMDB discover + three AI calls per request fan out toward the 50-subrequest free cap; the first limit hit is not the "100k req/day free" headline.
5. **No raw TCP sockets.** Supabase over HTTP/PostgREST is fine, but any direct Postgres (`pg`) connection won't run on Workers — a silent constraint if data access ever changes.

### Pre-Mortem — How This Could Fail

The team shipped on Cloudflare Pages because the starter defaulted to it. Early demos worked. Then the AI-justification feature landed: the AI SDK assumed Node streams, failed only in workerd, and never reproduced locally because the pinned adapter's `astro dev` didn't fully mirror the runtime. Flipping `nodejs_compat` fixed one import but exposed subrequest/CPU caps when TMDB plus three AI calls fanned out per request, throttling intermittently on the free plan. They'd pinned Astro 6 beta to obtain adapter v13; a beta regression broke the build mid-sprint with no stable fallback short of a downgrade. The one night production broke, Pages rollback turned out to be dashboard-only, so the "agent-driven recovery" story collapsed into manual clicking at 11pm. By month six they migrated to Workers static-assets — the path Cloudflare had signposted all along — burning a week the 3-week MVP's maintenance tail couldn't spare.

### Unknown Unknowns

- **Pages is in soft-sunset for new SSR.** The starter's `cloudflare-pages` target may be the legacy path; confirm whether to scaffold onto Workers static-assets instead.
- **`astro dev` workerd fidelity is adapter-version-dependent.** On older adapters the dev server is plain Node, so runtime-only bugs appear only after deploy.
  - **Update (2026-06-02, verified during `provision-external-apis`):** Resolved for this repo. `@astrojs/cloudflare@13.5.0` depends on `@cloudflare/vite-plugin` (workerd binary present in `node_modules/@cloudflare/`), so `astro dev` **runs the app in real workerd locally** (reading `.dev.vars`). The "plain Node dev server" hedge does **not** apply at the pinned version — a local `astro dev` pass is a genuine workerd pass. Remote deploy is then only needed to validate secret provisioning, not runtime compatibility.
- **The $5/mo paid jump buys CPU/limits, not requests.** Easy to misjudge budgeting when the binding limit is subrequests/CPU.
- **`wrangler` Pages vs Workers subcommands are not interchangeable.** Agent muscle memory from Workers docs misfires on Pages.
- **Secrets are not available at build time on Workers.** Server env must be read at runtime via `cloudflare:workers`; the starter encodes this but it's easy to break.

## Operational Story

- **Preview deploys**: every push/PR builds a preview deployment with a unique `*.workers.dev` (or `*.pages.dev`) URL via the GitHub integration. Preview URLs are public by default — gate sensitive previews with Cloudflare Access if needed. Fork PRs do not receive secrets.
- **Secrets**: `SUPABASE_URL`, `SUPABASE_KEY`, TMDB and AI API keys live as Workers Secrets (`wrangler secret put <NAME>`) and as GitHub repo secrets for CI; they are **not** exposed to client code and are read at runtime via `astro:env` / `cloudflare:workers`, never at build time. Rotation: `wrangler secret put` overwrites; redeploy to pick up.
- **Rollback**: Workers — `wrangler rollback [version-id]` reverts to any of the last 100 versions in seconds, no rebuild. (Pages rollback is dashboard-only — another reason to target Workers.) No automatic DB rollback: Supabase migrations must be reverted separately.
- **Approval**: an agent may deploy, tail logs, and roll back Workers versions unattended. Human-only actions: rotating the Supabase service key, deleting the Worker/project, and any Supabase schema/data-destructive migration.
- **Logs**: `wrangler tail` streams live runtime logs; `wrangler deployments list` and `wrangler versions list` show deploy history. GA Cloudflare Observability MCP server exposes structured log/metric queries to Cursor/Claude read-only.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Deploy to legacy Pages, then forced migration to Workers | Devil's advocate / Unknown unknowns | M | M | Target Workers static-assets from day one; verify what the starter scaffolds before first deploy |
| Pages rollback is dashboard-only, breaking unattended recovery | Research finding | M | M | Use Workers (CLI `wrangler rollback`); document the rollback command in the deploy plan |
| Node-only dep (AI SDK, Supabase client) fails only at runtime in workerd | Devil's advocate / Pre-mortem | M | H | Pin a GA adapter whose `astro dev` mirrors workerd; smoke-test the AI + TMDB path against a real deploy/preview before relying on local dev |
| Astro 6 beta + adapter v13 instability mid-sprint | Devil's advocate | M | H | Pin the GA line (Astro 5 / adapter v11) for the MVP; defer the beta upgrade |
| Subrequest (50 free) / CPU caps throttle TMDB + multi-call AI fan-out | Devil's advocate / Pre-mortem | M | M | Batch/limit candidate count and AI calls per request; monitor with `wrangler tail`; upgrade to $5/mo paid if CPU-bound |
| `<10s` recommendation NFR breached by slow AI upstream | Research finding / PRD | M | M | Cap candidate set, set client-visible timeout, stream/short-circuit; AI is a feature flag — degrade gracefully if upstream is slow |
| Build-time secret access mistake leaks or breaks env | Unknown unknowns | L | H | Keep `astro:env` server-only declarations; never read secrets in client or at build; covered by AGENTS.md hard rule |
| No raw TCP — future direct Postgres access won't run on Workers | Devil's advocate | L | M | Keep Supabase access over HTTP/PostgREST; avoid `pg`-style direct connections |

## Getting Started

Commands validated against the project's pinned stack (`10x-astro-starter`, npm, Node 22.14.0, `@astrojs/cloudflare`). The starter already includes the Cloudflare adapter and `astro:env` config — do **not** re-run `astro add cloudflare`.

1. **Install Wrangler** (project-local, matches CI): `npm i -D wrangler` then `npx wrangler login`.
2. **Confirm the deploy target.** Inspect the starter's `astro.config.mjs` and `wrangler.toml`/`wrangler.jsonc` — confirm whether it scaffolds Pages or Workers static-assets, and standardize on **Workers** for CLI rollback. (`npx astro sync` first if Astro types are stale.)
3. **Set secrets** for local + remote: copy `.env.example` to `.dev.vars` (never commit it), then `npx wrangler secret put SUPABASE_URL`, `SUPABASE_KEY`, and TMDB/AI keys for the deployed environment. Mirror them as GitHub repo secrets for CI.
4. **Build & deploy**: `npm run build` (the starter wires the Cloudflare adapter), then deploy via the project's script — Workers: `npx wrangler deploy`; Pages: `npx wrangler pages deploy ./dist`. CI is configured for auto-deploy-on-merge to `main`.
5. **Verify ops loop**: `npx wrangler tail` to confirm live logs, and note the rollback command (`npx wrangler rollback`) before the first production push.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (the starter ships GitHub Actions auto-deploy)
- Production-scale architecture (multi-region, HA, DR)

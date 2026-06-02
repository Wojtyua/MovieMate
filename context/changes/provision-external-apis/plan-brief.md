# Provision External APIs (TMDB + OpenRouter) — Plan Brief

> Full plan: `context/changes/provision-external-apis/plan.md`

## What & Why

Foundation slice **F-01**: provision and verify MovieMate's two external integrations — TMDB (movie data) and an AI provider (justifications) — so the north-star path (S-03 scoring, S-04 justifications) has a tested, workerd-safe client seam. The slice is dead-narrow on purpose: declare keys, lay thin clients, and prove a real call returns from the Cloudflare workerd runtime. Sequenced first because the entire recommendation engine is dead without verified external access, and workerd's runtime risk is best de-risked by a thin call before the engine exists.

## Starting Point

Keys exist only as raw values in `.env`. They are not in the `astro:env` schema (which has only Supabase), not in `.dev.vars` (local workerd secrets), and not in `.env.example`. There are no external-API client modules and no verify path. The repo already has strong patterns to mirror: `supabase.ts` (returns `null` when unconfigured), `config-status.ts`, and middleware that populates `locals.user`.

## Desired End State

TMDB + OpenRouter keys are declared as `astro:env` server secrets and provisioned locally and on the Worker. Two thin raw-`fetch` clients (`tmdb.ts`, `ai.ts`) exist and degrade gracefully. An auth-gated `GET /api/health/integrations` returns `{ tmdb: "ok", ai: "ok" }` under `astro dev` — which already runs in workerd via the Cloudflare Vite plugin, so the local pass genuinely proves workerd compatibility — and is confirmed once on the live Worker for remote provisioning.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| AI provider | OpenRouter | One OpenAI-compatible integration; swap models via config, deferring the roadmap's open "which model" question cheaply. | Plan |
| AI client transport | Raw `fetch` (no SDK) | Eliminates the #1 infra risk — Node-only SDKs fail only at runtime after deploy. | Plan |
| Verify mechanism | Auth-gated diagnostic API route | Actually exercises the workerd runtime; reusable health check; guarded so it can't burn quota. | Plan |
| Scope | Provision + verify + thin client stubs | S-03/S-04 inherit a tested client seam; no throwaway verify code. | Plan |
| TMDB credential | v4 read-access-token (Bearer) | Current scheme, covers all read endpoints, keeps the secret out of URLs/logs. | Plan |
| Route guard | In-route `locals.user` → 401 JSON | Reuses the existing auth seam; clean 401 for an API vs the page-oriented redirect. | Plan |
| AI model default | Cheap small model, env-configurable (`AI_MODEL`) | Short justifications → near-zero cost + low latency for the <10s NFR; retunable without code change. | Plan |
| F-01 verify gate | `astro dev` (workerd) is binding; remote hit = one-time ops smoke | `astro dev` already runs in workerd, so it proves runtime compat locally; remote only validates secret provisioning. | Plan |

## Scope

**In scope:** `astro:env` declarations; `.env.example` + `.dev.vars` + Worker/GitHub secrets; `tmdb.ts` + `ai.ts` with `ping*` health calls; `config-status.ts` entries; auth-gated diagnostic route; workerd preview verification.

**Out of scope:** TMDB discover/filter/scoring (S-03); justification prompt design + AI feature flag (S-04); OpenAI-direct path; the v3 TMDB key; data model/migrations; an automated test suite (Module 3).

## Architecture / Approach

Three thin layers in dependency order: (1) env contract + secret provisioning so config reads at runtime; (2) raw-`fetch` clients mirroring the `supabase.ts` null-when-unconfigured shape, each exposing a single-request `ping*`; (3) an auth-gated route that calls both `ping*` and returns per-provider ok/fail JSON. Verification is run locally and then against a workerd preview deploy.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Env contract & secrets | Keys declared in `astro:env`, provisioned local + remote | Build-time secret-access mistake; forgetting `.dev.vars` ≠ `.env` for workerd |
| 2. Thin client modules | `tmdb.ts` + `ai.ts` (raw fetch, ping calls) + config-status | Accidentally pulling a Node-only dependency that fails only at runtime |
| 3. Diagnostic route & verify | Auth-gated `/api/health/integrations`; `astro dev` (workerd) pass + one-time remote ops smoke | Remote secret-provisioning typo surfacing late (mitigated by the one-time live hit) |

**Prerequisites:** Deploy baseline present (done); all four API keys obtained (done); `.dev.vars` populated for local workerd dev; ability to set Worker/GitHub secrets for the one-time remote smoke.
**Estimated effort:** ~1 focused session across 3 small phases.

## Open Risks & Assumptions

- `astro dev` runs in workerd here (`@astrojs/cloudflare@13.5.0` + `@cloudflare/vite-plugin`), so the local pass **is** the binding runtime gate; the remote hit is a one-time ops smoke for secret provisioning. (Corrects the older `infrastructure.md` hedge that `astro dev` is plain Node.)
- Assumes OpenRouter's OpenAI-compatible `/chat/completions` and TMDB v4 Bearer auth behave as documented from workerd (the very thing the verify call confirms).
- The diagnostic route spends real API quota per hit — hence the auth guard and single-request pings.

## Success Criteria (Summary)

- Logged-in `GET /api/health/integrations` returns `ok` for both TMDB and AI under `astro dev` (workerd); confirmed once on the live Worker.
- Unauthenticated access returns `401`; missing a key reports `fail` without crashing the app.
- Lint + build pass; no secrets committed.

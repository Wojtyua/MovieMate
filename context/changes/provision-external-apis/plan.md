# Provision External APIs (TMDB + OpenRouter) Implementation Plan

## Overview

Provision and verify MovieMate's two external integrations — TMDB (movie data) and an AI provider (justifications) — so the north-star path (S-03 scoring, S-04 justifications) has a tested, workerd-safe seam to build on. This is foundation slice **F-01**: keys are declared via `astro:env`, set as Worker secrets, and a thin end-to-end call to each provider returns successfully from the Cloudflare workerd runtime. The AI provider is **OpenRouter** (OpenAI-compatible HTTP API), called over **raw `fetch`** to dodge the runtime's #1 risk (Node-only SDKs failing only after deploy).

## Current State Analysis

- Keys exist **only** in `.env` (raw, local): `TMDB_READ_ACCESS_TOKEN`, `TMDB_API_KEY` (v3), `OPENAI_API_KEY`, `OPENROUTER_API_KEY`.
- `astro:env` schema declares **only** Supabase (`astro.config.mjs:17-22`).
- `.dev.vars` (local workerd secrets) contains **only** `SUPABASE_URL` / `SUPABASE_KEY`.
- `.env.example` lists only the two Supabase keys.
- No external-API client modules, no verify path.
- **Established patterns to mirror:**
  - `src/lib/supabase.ts:5-8` — reads from `astro:env/server`, returns `null` when unconfigured (graceful degradation, no throw).
  - `src/lib/config-status.ts:11-21` — array of `ConfigStatus` reporting per-integration "configured?" with a docs link; `missingConfigs` derived filter.
  - `src/pages/api/auth/signin.ts` — `APIRoute` handler shape.
  - `src/middleware.ts:14-29` — populates `context.locals.user` on every request from the Supabase session; `PROTECTED_ROUTES` redirects unauthenticated **pages** to `/auth/signin`.
- **Dominant constraint (infrastructure.md risk register):** workerd ≠ Node. Web-standard `fetch` only; no Node streams; Node-only deps fail **only at runtime** after deploy. Free-plan limiter is subrequests (50) / CPU, not request count. Secrets are runtime-only (not available at build time).

## Desired End State

- `astro.config.mjs` declares `TMDB_READ_ACCESS_TOKEN`, `OPENROUTER_API_KEY` (server secrets) and `AI_MODEL` (server, optional) alongside the existing Supabase entries.
- `.env.example` documents every key a developer must supply; `.dev.vars` and Worker/GitHub secrets carry the real values.
- `src/lib/tmdb.ts` and `src/lib/ai.ts` expose workerd-safe, raw-`fetch` clients that return `null` when unconfigured and each provide a lightweight `ping*` health call.
- `src/lib/config-status.ts` reports TMDB and AI presence next to Supabase.
- `GET /api/health/integrations` (auth-gated → 401 JSON when unauthenticated) returns `{ tmdb: "ok" | "fail", ai: "ok" | "fail", ... }`.
- **Verification gate (two tiers):**
  - *Runtime (binding):* logged in, the route returns `ok` for both providers under `astro dev` — which runs in workerd locally (Cloudflare Vite plugin) reading `.dev.vars`, so this genuinely proves the calls work on the target runtime.
  - *Ops (one-time smoke):* after `wrangler secret put` + redeploy, one hit against the live Worker confirms remote secrets resolve. This validates provisioning, not runtime compatibility (already proven locally).

### Key Discoveries:

- Graceful-degradation contract is already established (`src/lib/supabase.ts:6-8`) — new clients must follow it (return `null`, never throw on missing config) so the app degrades instead of crashing.
- `context.locals.user` is already populated by middleware (`src/middleware.ts:16-23`), so the diagnostic route guards itself with one `locals.user` check — no middleware change needed.
- `PROTECTED_ROUTES` (`src/middleware.ts:4`) is page-oriented (it redirects); reusing it for an API route would issue a 302 to signin instead of a clean 401 — so guard in-route instead.
- OpenRouter exposes an OpenAI-compatible `POST https://openrouter.ai/api/v1/chat/completions`; plain `fetch` with a `Bearer` token is workerd-safe.
- TMDB v4 read-access-token authenticates via `Authorization: Bearer <token>`; a cheap liveness endpoint is `GET https://api.themoviedb.org/3/authentication` (or `/3/configuration`).

## What We're NOT Doing

- **No candidate retrieval, discover queries, filtering, or scoring** — that is S-03 (`scored-recommendations`). Client modules stay at "can we reach the API" depth.
- **No justification prompt design or AI feature-flag plumbing** — that is S-04 (`ai-justifications`). The AI client only proves a minimal completion returns.
- **No OpenAI-direct path** — `OPENAI_API_KEY` and the v3 `TMDB_API_KEY` stay in `.env` unused and undeclared; OpenRouter + v4 Bearer are the credentials of record.
- **No data model / migrations** — F-01 touches no tables.
- **No automated test suite** — there is no app-level test runner yet (AGENTS.md); verification is the lint/build gate plus manual workerd checks. (Testing strategy is Module 3.)

## Implementation Approach

Three thin layers, each independently buildable: (1) declare the env contract and provision secrets so config is readable at runtime; (2) add raw-`fetch` client modules that mirror the Supabase null-when-unconfigured shape and expose `ping*` health calls; (3) expose an auth-gated diagnostic route that exercises both `ping*` calls and verify it from the real workerd runtime. The order is deliberate: clients can't read config until the schema exists, and the route can't ping until the clients exist.

## Critical Implementation Details

- **Secrets are runtime-only on workerd.** Read keys via `astro:env/server` inside request handlers / module functions — never at top-level build-time evaluation in a way that assumes a value. Follow the `supabase.ts` lazy-read shape.
- **`astro dev` runs in workerd here.** `@astrojs/cloudflare@13.5.0` pulls `@cloudflare/vite-plugin` (workerd binary present in `node_modules/@cloudflare/`), so `astro dev` executes the app on workerd locally against `.dev.vars` — the local runtime pass is therefore a genuine workerd pass (this corrects the older hedge in `infrastructure.md`, researched 2026-05-29, that `astro dev` is plain Node). The remote-deploy check then only validates secret provisioning/ops, not runtime compatibility.
- **Subrequest budget.** The diagnostic route makes 2 outbound calls; keep `ping*` to a single request each (no retries/fan-out) so the health check itself stays well under the 50-subrequest cap.

## Phase 1: Env Contract & Secret Provisioning

### Overview

Make the three new config values readable at runtime and provisioned across local + remote, without exposing them to client code or build time.

### Changes Required:

#### 1. `astro:env` schema

**File**: `astro.config.mjs`

**Intent**: Declare the new server-side config so `astro:env/server` can type and serve it, consistent with the existing Supabase entries.

**Contract**: Add to `env.schema`: `TMDB_READ_ACCESS_TOKEN` and `OPENROUTER_API_KEY` as `envField.string({ context: "server", access: "secret", optional: true })`; `AI_MODEL` as `envField.string({ context: "server", access: "secret", optional: true })`. `optional: true` matches the existing Supabase pattern so the app still builds/boots when keys are absent. Do **not** add `OPENAI_API_KEY` or the v3 `TMDB_API_KEY`.

#### 2. Developer env template

**File**: `.env.example`

**Intent**: Document every key a developer must supply locally so onboarding matches the new contract.

**Contract**: Append `TMDB_READ_ACCESS_TOKEN=###`, `OPENROUTER_API_KEY=###`, and `AI_MODEL=###` (with the chosen cheap default named in a trailing comment) beneath the existing Supabase lines.

#### 3. Local + remote secret provisioning (operator steps)

**File**: `.dev.vars` (local, git-ignored) + Worker/GitHub secrets (no repo file)

**Intent**: Supply real values to the local workerd dev runtime and to the deployed Worker + CI, per `infrastructure.md` §Operational Story.

**Contract**: Add `TMDB_READ_ACCESS_TOKEN`, `OPENROUTER_API_KEY`, and `AI_MODEL` to `.dev.vars`. For remote: `npx wrangler secret put <NAME>` for each, and mirror as GitHub repo secrets for CI. These are operator/manual actions (the `.dev.vars` write is local-only; secrets are never committed — AGENTS.md hard rule).

### Success Criteria:

#### Automated Verification:

- `npx astro sync` then `npm run build` succeeds with the expanded schema
- Linting passes: `npm run lint`
- `.env.example` contains the three new keys

#### Manual Verification:

- `.dev.vars` contains the three new values locally (not committed)
- `wrangler secret put` run for all three on the deployed Worker; mirrored as GitHub repo secrets

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that `.dev.vars` and Worker/GitHub secrets are set before proceeding.

---

## Phase 2: Thin Workerd-Safe Client Modules

### Overview

Add raw-`fetch` clients for TMDB and OpenRouter that mirror the Supabase graceful-degradation contract and expose a single-request health check each, plus surface their config status.

### Changes Required:

#### 1. TMDB client

**File**: `src/lib/tmdb.ts` (new)

**Intent**: Provide a workerd-safe TMDB access seam usable by the verify route now and S-03 later, returning `null` when unconfigured rather than throwing.

**Contract**: Read `TMDB_READ_ACCESS_TOKEN` from `astro:env/server`. Export a factory (mirroring `createClient` in `supabase.ts`) that returns `null` when the token is absent, plus an async `pingTmdb()` that issues one `fetch` to `https://api.themoviedb.org/3/authentication` with `Authorization: Bearer <token>` and resolves to a boolean/ok-status (no retries). No Node APIs.

#### 2. AI (OpenRouter) client

**File**: `src/lib/ai.ts` (new)

**Intent**: Provide a workerd-safe OpenRouter access seam (OpenAI-compatible) for justifications later, proving a minimal completion returns now.

**Contract**: Read `OPENROUTER_API_KEY` and `AI_MODEL` from `astro:env/server`; fall back to a hardcoded cheap default model constant when `AI_MODEL` is unset. Return `null` when the key is absent. Export an async `pingAi()` that issues one `POST https://openrouter.ai/api/v1/chat/completions` via `fetch` with `Authorization: Bearer <key>`, a minimal `messages` payload, and a tiny `max_tokens`, resolving to a boolean/ok-status. Set OpenRouter's recommended `HTTP-Referer` / `X-Title` headers. No SDK, no streaming.

#### 3. Config status surface

**File**: `src/lib/config-status.ts`

**Intent**: Report TMDB and AI presence alongside Supabase so missing config is visible in the existing UI surface.

**Contract**: Add two `ConfigStatus` entries reading the new env vars for the `configured` boolean, following the existing object shape (name, configured, message, optional docs link). Polish-language `message` to match the existing entry's style.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint` (no stray `console.*` — `no-console` is a warning)

#### Manual Verification:

- Code review confirms both clients use only `fetch` (no Node-only imports) and return `null` when unconfigured

---

## Phase 3: Guarded Diagnostic Route & Workerd Verification

### Overview

Expose an auth-gated endpoint that exercises both `ping*` calls and confirm it returns `ok` from the real workerd runtime — the F-01 success gate.

### Changes Required:

#### 1. Diagnostic route

**File**: `src/pages/api/health/integrations.ts` (new)

**Intent**: Provide the thin end-to-end call that proves TMDB + AI are reachable from workerd, reusing the existing auth seam to prevent quota abuse.

**Contract**: `GET` `APIRoute`. Guard with `context.locals.user` — return `401` JSON when absent (do **not** redirect; this is an API). When authenticated, call `pingTmdb()` and `pingAi()` and return JSON `{ tmdb: "ok" | "fail", ai: "ok" | "fail" }` (include a short error detail per provider on failure). Follow the `APIRoute` shape in `src/pages/api/auth/signin.ts`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Unauthenticated `GET /api/health/integrations` returns `401`
- **Binding runtime gate:** logged in under `astro dev` (workerd, reading `.dev.vars`) → route returns `{ tmdb: "ok", ai: "ok" }`
- **One-time ops smoke:** after remote secrets are set + redeploy, one hit against the live Worker returns `ok` for both (confirms provisioning, not runtime — already proven locally)

**Implementation Note**: The binding criterion is the `astro dev` (workerd) pass — that is the real runtime proof for F-01. The remote hit is a one-time confirmation that `wrangler secret put` / CI secrets are wired; it does not need a per-phase repeat or a preview-domain Supabase redirect setup (the live domain already has working auth).

---

## Testing Strategy

### Unit Tests:

- None — no app-level test runner exists yet (AGENTS.md); deferred to Module 3.

### Integration Tests:

- The diagnostic route **is** the integration test: it exercises both real providers end-to-end from the runtime.

### Manual Testing Steps:

1. `npm run dev`, sign in, open `/api/health/integrations` → expect `{ tmdb: "ok", ai: "ok" }`.
2. Hit the route while logged out → expect `401`.
3. Temporarily unset a key in `.dev.vars` → expect that provider to report `fail` (and the app not to crash) → restore.
4. One-time ops smoke: after `wrangler secret put` + redeploy, sign in on the live domain, hit the route → expect `ok` for both (confirms remote secrets resolve).

## Performance Considerations

- Each `ping*` is a single outbound request; the route makes 2 subrequests total — far under the 50-subrequest free cap.
- AI default is a cheap small model with tiny `max_tokens`, keeping the verify call fast and near-zero cost; `AI_MODEL` lets S-04 retune without code change.

## Migration Notes

- No data migrations. Rotation per `infrastructure.md` §Operational Story: `wrangler secret put` overwrites, then redeploy.

## References

- Roadmap slice F-01: `context/foundation/roadmap.md:61-73`
- Infra risk register (workerd, secrets, subrequest caps): `context/foundation/infrastructure.md:79-98`
- Graceful-degradation pattern: `src/lib/supabase.ts:5-24`
- Config-status pattern: `src/lib/config-status.ts:11-21`
- Auth seam: `src/middleware.ts:14-29`; `APIRoute` shape: `src/pages/api/auth/signin.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Env Contract & Secret Provisioning

#### Automated

- [x] 1.1 `npx astro sync` then `npm run build` succeeds with the expanded schema — 4e753a4
- [x] 1.2 Linting passes: `npm run lint` — 4e753a4
- [x] 1.3 `.env.example` contains the three new keys — 4e753a4

#### Manual

- [x] 1.4 `.dev.vars` contains the three new values locally (not committed) — 4e753a4
- [x] 1.5 `wrangler secret put` run for all three on the deployed Worker; mirrored as GitHub repo secrets — 4e753a4

### Phase 2: Thin Workerd-Safe Client Modules

#### Automated

- [x] 2.1 Type checking passes: `npx astro sync && npm run build` — 63ee6ab
- [x] 2.2 Linting passes: `npm run lint` — 63ee6ab

#### Manual

- [x] 2.3 Code review confirms both clients use only `fetch` (no Node-only imports) and return `null` when unconfigured — 63ee6ab

### Phase 3: Guarded Diagnostic Route & Workerd Verification

#### Automated

- [x] 3.1 Type checking passes: `npx astro sync && npm run build` — 8006ee7
- [x] 3.2 Linting passes: `npm run lint` — 8006ee7

#### Manual

- [x] 3.3 Unauthenticated `GET /api/health/integrations` returns `401` — 8006ee7
- [x] 3.4 Binding runtime gate: logged in under `astro dev` (workerd) → route returns `{ tmdb: "ok", ai: "ok" }` — 8006ee7
- [x] 3.5 One-time ops smoke: after remote secrets + redeploy, live Worker returns `ok` for both — b71f6b6

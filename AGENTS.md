# Repository Guidelines

MovieMate turns two viewers' preferences into three justified movie-night recommendations. Product spec: `@context/foundation/shape-notes.md`. Stack and versions: `@package.json`, `@.nvmrc`.

## Agent Workspace

This repo is shared by multiple coding agents. `AGENTS.md` is the single source of truth; Cursor and Codex read it natively, and `@CLAUDE.md` re-points here. Edit rules here, not in the pointer files.

## Hard Rules

- `SUPABASE_URL` / `SUPABASE_KEY` are server-only secrets declared in `@astro.config.mjs` (`astro:env`). Never expose them to client code or hardcode them.
- Never commit `.env` or `.dev.vars`; copy from `@.env.example`.
- Run `npm run lint` before pushing — CI gates on it (see `@.github/workflows/ci.yml`).
- `no-console` is a lint warning; remove stray `console.*` before committing.

## Build, Test, and Development Commands

- Scripts: `@package.json` (`dev` runs on the Cloudflare workerd runtime).
- Run `npx astro sync` before `npm run build` if Astro types are stale.
- Use Node `22.14.0` (`@.nvmrc`) and npm. DB tests use pgTAP under `supabase/tests/`, run via `npm run db:verify`; there is no app-level test suite yet.

## Project Structure & Module Organization

- `src/pages/` — Astro routes; `src/pages/api/` for endpoints, `src/pages/auth/` for auth pages.
- `src/components/` — `ui/` (shadcn, new-york style) and `auth/`; `src/layouts/` for layouts.
- `src/lib/` — `supabase.ts`, `utils.ts`, `config-status.ts`. `src/middleware.ts` guards routes via `PROTECTED_ROUTES`.
- DB schema in `supabase/migrations/`; tables + RLS follow `@docs/reference/persistence-conventions.md` (source of truth — owner-scoped `auth.uid()` policies, `db:*` workflow).
- Import with the `@/*` alias (`@/components`, `@/lib/utils`); see `@tsconfig.json` and `@components.json`.

## Coding Style & Naming Conventions

- TypeScript and ESLint: `@tsconfig.json`, `@eslint.config.js`. Formatting: `@.prettierrc.json`.
- Prefix intentionally unused vars/args with `_`. Add shadcn components under `@/components/ui`.

## Commit & Pull Request Guidelines

- Use imperative commit subjects under 72 characters (e.g. `add auth middleware`, `fix supabase env leak`); body optional.
- A `pre-commit` hook runs `lint-staged` (`@.husky/pre-commit`): ESLint on `*.{ts,tsx,astro}`, Prettier on `*.{json,css,md}`.
- CI runs lint + build on push/PR to `main`; set `SUPABASE_URL`/`SUPABASE_KEY` as repo secrets.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
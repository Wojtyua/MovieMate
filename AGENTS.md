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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill                                  | Use it when                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change setup (lesson focus)**        |                                                                                                                                                                                                                                                                      |
| `/10x-new <change-id>`                 | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`.               |
| **Planning (lesson focus)**            |                                                                                                                                                                                                                                                                      |
| `/10x-plan <change-id>`                | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-plan-review <change-id>`         | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin.                                                                          |
| **Implementation (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`.                                                                                                                          |
| **Lifecycle closure**                  |                                                                                                                                                                                                                                                                      |
| `/10x-archive <change-id>`             | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state.                                                                                                                                                             |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->

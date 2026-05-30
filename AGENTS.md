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
- Use Node `22.14.0` (`@.nvmrc`) and npm. There is no test suite yet.

## Project Structure & Module Organization

- `src/pages/` — Astro routes; `src/pages/api/` for endpoints, `src/pages/auth/` for auth pages.
- `src/components/` — `ui/` (shadcn, new-york style) and `auth/`; `src/layouts/` for layouts.
- `src/lib/` — `supabase.ts`, `utils.ts`, `config-status.ts`. `src/middleware.ts` guards routes via `PROTECTED_ROUTES`.
- Import with the `@/*` alias (`@/components`, `@/lib/utils`); see `@tsconfig.json` and `@components.json`.

## Coding Style & Naming Conventions

- TypeScript and ESLint: `@tsconfig.json`, `@eslint.config.js`. Formatting: `@.prettierrc.json`.
- Prefix intentionally unused vars/args with `_`. Add shadcn components under `@/components/ui`.

## Commit & Pull Request Guidelines

- Use imperative commit subjects under 72 characters (e.g. `add auth middleware`, `fix supabase env leak`); body optional.
- A `pre-commit` hook runs `lint-staged` (`@.husky/pre-commit`): ESLint on `*.{ts,tsx,astro}`, Prettier on `*.{json,css,md}`.
- CI runs lint + build on push/PR to `main`; set `SUPABASE_URL`/`SUPABASE_KEY` as repo secrets.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Roadmap (lesson focus)** | |
| `/10x-roadmap` | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed** | |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready. |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->

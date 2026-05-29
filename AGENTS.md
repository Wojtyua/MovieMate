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
- CI runs lint + build on push/PR to `master`; set `SUPABASE_URL`/`SUPABASE_KEY` as repo secrets.

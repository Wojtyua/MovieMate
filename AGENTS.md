# Repository Guidelines

MovieMate is an Astro v6 (server output) + React 19 + TypeScript web app that turns two viewers' preferences into three justified movie-night recommendations. Stack: Tailwind v4, shadcn/ui, Supabase Auth, deployed to Cloudflare Workers. Product spec lives in `@context/foundation/shape-notes.md`.

## Agent Workspace

This repo is shared by multiple coding agents. `AGENTS.md` is the single source of truth; Cursor and Codex read it natively, and `@CLAUDE.md` re-points here. Edit rules here, not in the pointer files.

## Hard Rules

- `SUPABASE_URL` / `SUPABASE_KEY` are server-only secrets declared in `@astro.config.mjs` (`astro:env`). Never expose them to client code or hardcode them.
- Never commit `.env` or `.dev.vars`; copy from `@.env.example`.
- Run `npm run lint` before pushing — CI gates on it (see `@.github/workflows/ci.yml`).
- `no-console` is a lint warning; remove stray `console.*` before committing.

## Build, Test, and Development Commands

- `npm run dev` — start dev server on the Cloudflare workerd runtime.
- `npm run build` — production build (run `npx astro sync` first if types are stale).
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules.
- `npm run format` — Prettier across the repo.
- Use Node `22.14.0` (`@.nvmrc`) and npm. There is no test suite yet.

## Project Structure & Module Organization

- `src/pages/` — Astro routes; `src/pages/api/` for endpoints, `src/pages/auth/` for auth pages.
- `src/components/` — `ui/` (shadcn, new-york style) and `auth/`; `src/layouts/` for layouts.
- `src/lib/` — `supabase.ts`, `utils.ts`, `config-status.ts`. `src/middleware.ts` guards routes via `PROTECTED_ROUTES`.
- Import with the `@/*` alias (`@/components`, `@/lib/utils`); see `@tsconfig.json` and `@components.json`.

## Coding Style & Naming Conventions

- TypeScript strict (`astro/tsconfigs/strict` + `strictTypeChecked`); avoid `any`. Config in `@eslint.config.js`.
- 2-space indent, double quotes, formatted by Prettier (`@.prettierrc.json`).
- Prefix intentionally unused vars/args with `_`. Add shadcn components under `@/components/ui`.

## Commit & Pull Request Guidelines

- History has a single `init` commit and no remote; commit convention is to be defined — keep messages short and imperative.
- A `pre-commit` hook runs `lint-staged` (`@.husky/pre-commit`): ESLint on `*.{ts,tsx,astro}`, Prettier on `*.{json,css,md}`.
- CI runs lint + build on push/PR to `master`; set `SUPABASE_URL`/`SUPABASE_KEY` as repo secrets.

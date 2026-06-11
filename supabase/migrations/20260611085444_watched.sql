-- Watched-dedup (S-05): the per-account set of films the user has marked watched.
--
-- Built on the owner-scoped RLS convention (see docs/reference/persistence-conventions.md
-- and the rls_example reference migration, which names "watched-dedup (S-05)" as an
-- anticipated table). Enforces FR-001 ("a user can access only their own data") at the
-- data layer.
--
-- Purpose (FR-011 / FR-012): a film marked watched is excluded from all future candidate
-- retrieval for the account. "Watched" is a dedup filter only — NOT a scoring signal and
-- NOT a browsable list (PRD Non-Goals). The retrieval seam consumes this set as
-- `excludeMovieIds` (src/lib/tmdb-discover.ts) keyed by tmdb_movie_id.
--
-- Keyed by tmdb_movie_id (plain int, matching recommendation_picks.tmdb_movie_id) rather
-- than by pick id, so exclusion spans every run regardless of which run surfaced the film.

create table public.watched (
  id uuid primary key default gen_random_uuid(),
  -- Owner column convention: default auth.uid() lets clients insert without
  -- supplying user_id; on delete cascade cleans up when the auth user is removed.
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- TMDB movie id. Plain int to match recommendation_picks.tmdb_movie_id.
  tmdb_movie_id int not null,
  created_at timestamptz not null default now(),
  -- One row per (user, film): makes marking idempotent (upsert target) and is the
  -- dedup key the retrieval seam excludes on. No updated_at — rows are immutable.
  unique (user_id, tmdb_movie_id)
);

-- Index the owner column: RLS predicates filter on user_id on every request.
create index watched_user_id_idx on public.watched (user_id);

-- Enabling RLS is deny-by-default: with RLS on and no policies, all access by
-- roles subject to RLS (anon / authenticated) is blocked. PostgREST never connects
-- as the owner. Policies below restore owner-scoped access.
alter table public.watched enable row level security;

-- select: a user can read only their own watched rows.
create policy "watched_select_own" on public.watched
  for select
  using (auth.uid() = user_id);

-- insert: a user can mark watched only for themselves. The WITH CHECK pairs with
-- the column default — the default alone is not a security control.
create policy "watched_insert_own" on public.watched
  for insert
  with check (auth.uid() = user_id);

-- update: a user can update only their own rows, and cannot reassign ownership.
-- Both clauses are required for upsert (insert-or-update) to pass.
create policy "watched_update_own" on public.watched
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- delete: a user can delete only their own watched rows.
create policy "watched_delete_own" on public.watched
  for delete
  using (auth.uid() = user_id);

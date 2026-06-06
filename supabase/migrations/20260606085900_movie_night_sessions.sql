-- Movie-night sessions (S-02): one row per started movie-night, holding the
-- evening's preferences.
--
-- Second product table on the owner-scoped RLS convention
-- (see docs/reference/persistence-conventions.md and the viewer_profiles
-- migration). Enforces FR-001 ("a user can access only their own data") at the
-- data layer, and persists the six FR-004 preference fields that become the
-- input contract S-03 reads to retrieve + score TMDB candidates.
--
-- Unlike viewer_profiles, sessions are UNBOUNDED per user: each "start a
-- session" is a new row, so there is no slot and no unique constraint.
--
-- Genre preferences are stored as TMDB genre IDs so S-03's TMDB discover query
-- (FR-005) needs no name->id translation. mood/intensity are local-scoring
-- signals (FR-007), not TMDB hard filters; runtime_limit_minutes maps to the
-- TMDB with_runtime.lte hard filter when non-null ("no limit" when null).

create table public.movie_night_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Owner column convention: default auth.uid() lets clients insert without
  -- supplying user_id; on delete cascade cleans up when the auth user is removed.
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- Mood is a free-text column constrained to a fixed vocabulary in the API
  -- layer (src/lib/session-options.ts) rather than a DB enum, so the vocabulary
  -- can grow without a migration. Nullable: mood is optional.
  mood text,
  -- TMDB genre IDs. Default empty array keeps genres optional at save time.
  preferred_genre_ids int[] not null default '{}',
  excluded_genre_ids int[] not null default '{}',
  -- Optional runtime ceiling in minutes. NULL means "no limit" (S-03 omits the
  -- TMDB runtime hard filter). The CHECK rejects non-positive values.
  runtime_limit_minutes int check (runtime_limit_minutes is null or runtime_limit_minutes > 0),
  -- Ordinal intensity scale. Small, stable domain -> a DB CHECK is appropriate
  -- (mirrors the slot CHECK pattern); default keeps it optional at save time.
  intensity text not null default 'medium' check (intensity in ('low', 'medium', 'high')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index the owner column: RLS predicates filter on user_id on every request.
create index movie_night_sessions_user_id_idx on public.movie_night_sessions (user_id);

-- Enabling RLS is deny-by-default: with RLS on and no policies, all access by
-- roles subject to RLS (anon / authenticated) is blocked. The owner/superuser
-- bypass RLS, but PostgREST never connects as the owner. Policies below restore
-- owner-scoped access.
alter table public.movie_night_sessions enable row level security;

-- select: a user can read only their own sessions.
create policy "movie_night_sessions_select_own" on public.movie_night_sessions
  for select
  using (auth.uid() = user_id);

-- insert: a user can create sessions only for themselves. The WITH CHECK pairs
-- with the column default — the default alone is not a security control.
create policy "movie_night_sessions_insert_own" on public.movie_night_sessions
  for insert
  with check (auth.uid() = user_id);

-- update: a user can update only their own sessions, and cannot reassign
-- ownership (both clauses scoped to the owner).
create policy "movie_night_sessions_update_own" on public.movie_night_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- delete: a user can delete only their own sessions.
create policy "movie_night_sessions_delete_own" on public.movie_night_sessions
  for delete
  using (auth.uid() = user_id);

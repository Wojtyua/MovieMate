-- Scored recommendations (S-03): persist one recommendation run per generation
-- and its three role-labeled picks (safe / compromise / wild card).
--
-- Third and fourth product tables on the owner-scoped RLS convention
-- (see docs/reference/persistence-conventions.md and the viewer_profiles /
-- movie_night_sessions migrations). Enforces FR-001 ("a user can access only
-- their own data") at the data layer for both tables.
--
-- recommendations:       one row per "Get recommendations" run, tied to the
--                        session it was generated from. Runs are UNBOUNDED per
--                        session (mirroring movie_night_sessions): each run is a
--                        new row; the results page reads the latest run.
-- recommendation_picks:  the three picks of a run, each snapshotting the TMDB
--                        display fields so the results page renders without any
--                        TMDB call and S-04/S-05 can reference a stable pick id.

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  -- Owner column convention: default auth.uid() lets clients insert without
  -- supplying user_id; on delete cascade cleans up when the auth user is removed.
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- The session this run was generated from. Cascade-delete: removing a session
  -- removes its recommendation runs (and their picks, via the child cascade).
  session_id uuid not null references public.movie_night_sessions (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Index the owner column (RLS filters on user_id every request) and the session
-- column (the results page looks up runs by session_id).
create index recommendations_user_id_idx on public.recommendations (user_id);
create index recommendations_session_id_idx on public.recommendations (session_id);

create table public.recommendation_picks (
  id uuid primary key default gen_random_uuid(),
  -- Denormalized owner column so RLS is uniform per the convention (every table
  -- carries its own user_id rather than joining up to the parent).
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- The run this pick belongs to. Cascade-delete: removing a run removes its picks.
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  -- The three role labels (FR-009). A DB CHECK keeps the small, stable domain honest.
  role text not null check (role in ('safe', 'compromise', 'wild_card')),
  -- Snapshot of the TMDB candidate's display fields at generation time, so the
  -- results page renders without a TMDB call and survives later TMDB downtime.
  tmdb_movie_id int not null,
  score real not null,
  title text not null,
  poster_path text,
  overview text,
  genre_ids int[] not null default '{}',
  release_date text,
  vote_average real,
  created_at timestamptz not null default now(),
  -- At most one pick per role within a run.
  unique (recommendation_id, role)
);

-- Index the parent (results page loads picks by recommendation_id) and the owner
-- column (RLS predicate).
create index recommendation_picks_recommendation_id_idx on public.recommendation_picks (recommendation_id);
create index recommendation_picks_user_id_idx on public.recommendation_picks (user_id);

-- Enabling RLS is deny-by-default: with RLS on and no policies, all access by
-- roles subject to RLS (anon / authenticated) is blocked. PostgREST never
-- connects as the table owner, so the owner-scoped policies below restore access.
alter table public.recommendations enable row level security;
alter table public.recommendation_picks enable row level security;

-- recommendations: owner-scoped CRUD.
create policy "recommendations_select_own" on public.recommendations
  for select
  using (auth.uid() = user_id);

create policy "recommendations_insert_own" on public.recommendations
  for insert
  with check (auth.uid() = user_id);

create policy "recommendations_update_own" on public.recommendations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recommendations_delete_own" on public.recommendations
  for delete
  using (auth.uid() = user_id);

-- recommendation_picks: owner-scoped CRUD (uniform on the denormalized user_id).
create policy "recommendation_picks_select_own" on public.recommendation_picks
  for select
  using (auth.uid() = user_id);

create policy "recommendation_picks_insert_own" on public.recommendation_picks
  for insert
  with check (auth.uid() = user_id);

create policy "recommendation_picks_update_own" on public.recommendation_picks
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recommendation_picks_delete_own" on public.recommendation_picks
  for delete
  using (auth.uid() = user_id);

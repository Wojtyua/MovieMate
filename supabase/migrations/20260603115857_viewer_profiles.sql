-- Viewer profiles (S-01): the two taste profiles a user manages for movie nights.
--
-- First product table built on the owner-scoped RLS convention
-- (see docs/reference/persistence-conventions.md and the rls_example reference
-- migration). Enforces FR-001 ("a user can access only their own data") at the
-- data layer, and FR-002 ("exactly two viewer profiles") structurally via a
-- bounded `slot` plus a unique (user_id, slot) constraint.
--
-- Genre preferences are stored as TMDB genre IDs so S-03's TMDB discover query
-- (FR-005) needs no name->id translation.

create table public.viewer_profiles (
  id uuid primary key default gen_random_uuid(),
  -- Owner column convention: default auth.uid() lets clients insert without
  -- supplying user_id; on delete cascade cleans up when the auth user is removed.
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- Two fixed slots cap the pair at exactly two profiles (with the unique
  -- constraint below). The CHECK bounds the domain; the UNIQUE prevents dupes.
  slot smallint not null check (slot in (1, 2)),
  display_name text not null,
  -- TMDB genre IDs. Default empty array keeps genres optional at save time.
  preferred_genre_ids int[] not null default '{}',
  excluded_genre_ids int[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per (user, slot): together with the slot CHECK this caps a user at
  -- two profiles. Upserts target this constraint via on conflict (user_id, slot).
  unique (user_id, slot)
);

-- Index the owner column: RLS predicates filter on user_id on every request.
create index viewer_profiles_user_id_idx on public.viewer_profiles (user_id);

-- Enabling RLS is deny-by-default: with RLS on and no policies, all access by
-- roles subject to RLS (anon / authenticated) is blocked. The owner/superuser
-- bypass RLS, but PostgREST never connects as the owner. Policies below restore
-- owner-scoped access.
alter table public.viewer_profiles enable row level security;

-- select: a user can read only their own profiles.
create policy "viewer_profiles_select_own" on public.viewer_profiles
  for select
  using (auth.uid() = user_id);

-- insert: a user can create profiles only for themselves. The WITH CHECK pairs
-- with the column default — the default alone is not a security control.
create policy "viewer_profiles_insert_own" on public.viewer_profiles
  for insert
  with check (auth.uid() = user_id);

-- update: a user can update only their own profiles, and cannot reassign
-- ownership. Both clauses are required for upsert (insert-or-update) to pass.
create policy "viewer_profiles_update_own" on public.viewer_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- delete: a user can delete only their own profiles.
create policy "viewer_profiles_delete_own" on public.viewer_profiles
  for delete
  using (auth.uid() = user_id);

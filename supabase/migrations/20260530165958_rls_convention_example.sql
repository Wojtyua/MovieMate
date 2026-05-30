-- Canonical RLS convention example (REFERENCE PATTERN — NOT a product table).
--
-- This migration is the copyable template every owner-scoped table mirrors.
-- It is intentionally NOT a product entity: viewer profiles (S-01),
-- sessions/preferences (S-02), and watched-dedup (S-05) each ship their own
-- table with their consuming slice. A later change may drop `rls_example`
-- once a real table demonstrates the pattern.
--
-- The pattern enforces FR-001 ("a user can access only their own data") at the
-- data layer: every row is owned via `user_id`, RLS is enabled (deny-by-default),
-- and four per-command policies scope access to `auth.uid() = user_id`.

create table public.rls_example (
  id uuid primary key default gen_random_uuid(),
  -- Owner column convention: default auth.uid() lets clients insert without
  -- supplying user_id; on delete cascade cleans up when the auth user is removed.
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  note text,
  created_at timestamptz not null default now()
);

-- Index the owner column: RLS predicates filter on user_id on every request.
create index rls_example_user_id_idx on public.rls_example (user_id);

-- Enabling RLS is deny-by-default: with no policies, ALL access is blocked
-- (including via PostgREST as the table owner). Policies below restore
-- owner-scoped access.
alter table public.rls_example enable row level security;

-- select: a user can read only their own rows.
create policy "rls_example_select_own" on public.rls_example
  for select
  using (auth.uid() = user_id);

-- insert: a user can create rows only for themselves. The WITH CHECK pairs with
-- the column default — the default alone is not a security control.
create policy "rls_example_insert_own" on public.rls_example
  for insert
  with check (auth.uid() = user_id);

-- update: a user can update only their own rows, and cannot reassign ownership.
create policy "rls_example_update_own" on public.rls_example
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- delete: a user can delete only their own rows.
create policy "rls_example_delete_own" on public.rls_example
  for delete
  using (auth.uid() = user_id);

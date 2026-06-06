-- Own-data isolation + single-core uniqueness checks for viewer_profiles
-- (run via `npm run db:verify`).
--
-- Proves two things the convention promises:
--   FR-001 — RLS partitions the taste core by owner: each user reads only their
--            own row and cannot update/delete the other's.
--   FR-002 — a user owns at most one remembered taste core: a second row for the
--            same user_id fails the unique(user_id) constraint.
--
-- Mechanism: the postgres/superuser role and the table owner BYPASS RLS, so every
-- assertion impersonates a real user via `set local role authenticated` plus a
-- `request.jwt.claims` GUC carrying their `sub` — which is what `auth.uid()` reads.
-- The whole fixture runs inside one transaction that rolls back, so it is
-- idempotent and re-runnable without a `db:reset` in between.

begin;

create extension if not exists pgtap with schema extensions;

-- auth.users FK: user_id references auth.users(id), so the two subjects must be
-- real auth rows. `id` is the only NOT-NULL column without a default on this image.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- Seed one taste core per user. Done as superuser (RLS bypassed) with an explicit
-- user_id, since the auth.uid() default would be NULL outside a request.
insert into public.viewer_profiles (user_id, preferred_genre_ids) values
  ('11111111-1111-1111-1111-111111111111', '{28}'),
  ('22222222-2222-2222-2222-222222222222', '{35}');

select plan(8);

-- User A sees only their own core.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.viewer_profiles)::int,
  1,
  'user A sees exactly one taste core'
);
select is(
  (select user_id from public.viewer_profiles),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the core user A sees is user A''s own'
);
select is(
  (select count(*) from public.viewer_profiles where user_id = '22222222-2222-2222-2222-222222222222'::uuid)::int,
  0,
  'user A cannot see user B''s core'
);
reset role;

-- User B sees only their own core.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.viewer_profiles)::int,
  1,
  'user B sees exactly one taste core'
);
select is(
  (select preferred_genre_ids from public.viewer_profiles),
  '{35}'::int[],
  'the core user B sees is user B''s own'
);
reset role;

-- User A attempts to tamper with user B's core; RLS must filter both out
-- (no error, zero rows affected).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.viewer_profiles set preferred_genre_ids = '{99}' where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
delete from public.viewer_profiles where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
reset role;

-- Confirm user B's core survived untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.viewer_profiles)::int,
  1,
  'user B''s core survived user A''s cross-user delete attempt'
);
select is(
  (select preferred_genre_ids from public.viewer_profiles),
  '{35}'::int[],
  'user B''s core is unchanged after user A''s cross-user write attempts'
);
reset role;

-- Single-core cap (FR-002), exercised as user A who already owns a core.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- A second row for the same user_id violates the unique(user_id) constraint.
select throws_ok(
  $$ insert into public.viewer_profiles (preferred_genre_ids) values ('{12}') $$,
  '23505',
  null,
  'a second taste core for the same user is rejected by the unique(user_id) constraint'
);
reset role;

select * from finish();

rollback;

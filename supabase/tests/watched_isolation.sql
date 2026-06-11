-- Own-data isolation check for watched (run via `npm run db:verify`).
--
-- Proves what the convention promises for S-05:
--   FR-001 — RLS partitions watched by owner: each user reads only their own rows
--            and cannot delete the other's.
--   S-05   — the unique (user_id, tmdb_movie_id) constraint makes marking idempotent
--            (a duplicate mark for the same user+film is rejected), while the same
--            tmdb_movie_id under a different owner is allowed.
--
-- Mechanism: the postgres/superuser role and the table owner BYPASS RLS, so every
-- assertion impersonates a real user via `set local role authenticated` plus a
-- `request.jwt.claims` GUC carrying their `sub` — which is what `auth.uid()` reads.
-- The whole fixture runs inside one transaction that rolls back, so it is
-- idempotent and re-runnable without a `db:reset` in between.

begin;

create extension if not exists pgtap with schema extensions;

-- auth.users FK: user_id references auth.users(id), so the two subjects must be
-- real auth rows.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- Seed one watched row per user. Done as superuser (RLS bypassed) with explicit
-- user_id, since the auth.uid() default would be NULL outside a request. Both users
-- mark the SAME tmdb_movie_id (101) so we can prove the unique constraint is
-- per-owner, not global.
insert into public.watched (user_id, tmdb_movie_id) values
  ('11111111-1111-1111-1111-111111111111', 101),
  ('22222222-2222-2222-2222-222222222222', 101);

select plan(6);

-- User A sees only their own watched row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.watched)::int,
  1,
  'user A sees exactly one watched row'
);
select is(
  (select user_id from public.watched),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the watched row user A sees is user A''s own'
);
reset role;

-- User B sees only their own watched row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.watched)::int,
  1,
  'user B sees exactly one watched row'
);
reset role;

-- User A attempts to delete user B's row; RLS must filter it out (no error, zero
-- rows affected).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.watched where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
reset role;

-- Confirm user B's row survived untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.watched)::int,
  1,
  'user B''s watched row survived user A''s cross-user delete attempt'
);

-- Idempotent marking: re-marking a film the user already marked is rejected by the
-- unique (user_id, tmdb_movie_id) constraint (the endpoint upserts, but the
-- constraint is what guarantees no duplicate row).
select throws_ok(
  $$ insert into public.watched (tmdb_movie_id) values (101) $$,
  '23505',
  null,
  'the unique (user_id, tmdb_movie_id) constraint rejects a duplicate mark'
);

-- A distinct film for the same user succeeds (sanity that the constraint is
-- per-film, not per-user).
select lives_ok(
  $$ insert into public.watched (tmdb_movie_id) values (202) $$,
  'user B can mark a second, distinct film watched'
);
reset role;

select * from finish();

rollback;

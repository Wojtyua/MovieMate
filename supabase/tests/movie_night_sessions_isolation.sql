-- Own-data isolation check for movie_night_sessions (run via `npm run db:verify`).
--
-- Proves what the convention promises for S-02:
--   FR-001 — RLS partitions sessions by owner: each user reads only their own
--            rows and cannot update/delete the other's.
--   S-02   — sessions are UNBOUNDED per user: a user can insert many sessions
--            (the deliberate difference from viewer_profiles, which is capped at
--            one remembered taste core per user).
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

-- Seed one session per user. Done as superuser (RLS bypassed) with an explicit
-- user_id, since the auth.uid() default would be NULL outside a request.
insert into public.movie_night_sessions (user_id, mood, intensity, note) values
  ('11111111-1111-1111-1111-111111111111', 'cozy', 'low', 'A session'),
  ('22222222-2222-2222-2222-222222222222', 'tense', 'high', 'B session');

select plan(9);

-- User A sees only their own session.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.movie_night_sessions)::int,
  1,
  'user A sees exactly one session'
);
select is(
  (select user_id from public.movie_night_sessions),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the session user A sees is user A''s own'
);
select is(
  (select count(*) from public.movie_night_sessions where user_id = '22222222-2222-2222-2222-222222222222'::uuid)::int,
  0,
  'user A cannot see user B''s session'
);
reset role;

-- User B sees only their own session.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select note from public.movie_night_sessions),
  'B session',
  'the session user B sees is user B''s own'
);
reset role;

-- User A attempts to tamper with user B's session; RLS must filter both out
-- (no error, zero rows affected).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.movie_night_sessions set note = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
delete from public.movie_night_sessions where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
reset role;

-- Confirm user B's session survived untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.movie_night_sessions)::int,
  1,
  'user B''s session survived user A''s cross-user delete attempt'
);
select is(
  (select note from public.movie_night_sessions),
  'B session',
  'user B''s session is unchanged after user A''s cross-user write attempts'
);
reset role;

-- No per-user cap (S-02): a user can hold many sessions (unlike the single
-- remembered taste core). User A already owns one; two more inserts must succeed
-- and bring their visible total to three.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.movie_night_sessions (mood, intensity, note) values ('funny', 'medium', 'A session 2') $$,
  'user A can start a second session'
);
select lives_ok(
  $$ insert into public.movie_night_sessions (mood, intensity, note) values ('epic', 'high', 'A session 3') $$,
  'user A can start a third session (no per-user cap)'
);
select is(
  (select count(*) from public.movie_night_sessions)::int,
  3,
  'user A now sees all three of their own sessions'
);
reset role;

select * from finish();

rollback;

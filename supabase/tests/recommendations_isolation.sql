-- Own-data isolation check for recommendations + recommendation_picks
-- (run via `npm run db:verify`).
--
-- Proves what the convention promises for S-03:
--   FR-001 — RLS partitions recommendations and picks by owner: each user reads
--            only their own rows and cannot update/delete the other's.
--   S-03   — the (recommendation_id, role) unique constraint and the role CHECK
--            reject malformed picks.
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

-- Seed one session per user (recommendations.session_id FK), then one
-- recommendation run + one pick per user. Done as superuser (RLS bypassed) with
-- explicit user_id, since the auth.uid() default would be NULL outside a request.
insert into public.movie_night_sessions (id, user_id, mood, intensity) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'cozy', 'low'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'tense', 'high');

insert into public.recommendations (id, user_id, session_id) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.recommendation_picks (user_id, recommendation_id, role, tmdb_movie_id, score, title) values
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'safe', 101, 1.5, 'A safe pick'),
  ('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'safe', 202, 2.5, 'B safe pick');

select plan(10);

-- User A sees only their own recommendation + pick.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.recommendations)::int,
  1,
  'user A sees exactly one recommendation'
);
select is(
  (select session_id from public.recommendations),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the recommendation user A sees is for user A''s own session'
);
select is(
  (select count(*) from public.recommendation_picks)::int,
  1,
  'user A sees exactly one pick'
);
select is(
  (select title from public.recommendation_picks),
  'A safe pick',
  'the pick user A sees is user A''s own'
);
reset role;

-- User B sees only their own recommendation + pick.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select title from public.recommendation_picks),
  'B safe pick',
  'the pick user B sees is user B''s own'
);
reset role;

-- User A attempts to tamper with user B's rows; RLS must filter both out
-- (no error, zero rows affected).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.recommendation_picks set title = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
delete from public.recommendation_picks where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
update public.recommendations set session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
delete from public.recommendations where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
reset role;

-- Confirm user B's rows survived untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.recommendations)::int,
  1,
  'user B''s recommendation survived user A''s cross-user delete attempt'
);
select is(
  (select title from public.recommendation_picks),
  'B safe pick',
  'user B''s pick is unchanged after user A''s cross-user write attempts'
);
reset role;

-- The role CHECK rejects an unknown role.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.recommendation_picks (recommendation_id, role, tmdb_movie_id, score, title)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bogus', 303, 1.0, 'bad role') $$,
  '23514',
  null,
  'the role CHECK rejects an unknown role'
);

-- The (recommendation_id, role) unique constraint rejects a duplicate role.
select throws_ok(
  $$ insert into public.recommendation_picks (recommendation_id, role, tmdb_movie_id, score, title)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'safe', 303, 1.0, 'dup role') $$,
  '23505',
  null,
  'the unique (recommendation_id, role) constraint rejects a duplicate role'
);

-- A valid second role for the same run succeeds (sanity that the unique
-- constraint is per-role, not per-run).
select lives_ok(
  $$ insert into public.recommendation_picks (recommendation_id, role, tmdb_movie_id, score, title)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'wild_card', 303, 1.0, 'B wild card') $$,
  'user B can add a second pick with a distinct role'
);
reset role;

select * from finish();

rollback;

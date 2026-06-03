-- Own-data isolation + slot-cap checks for viewer_profiles (run via `npm run db:verify`).
--
-- Proves two things the convention promises:
--   FR-001 — RLS partitions profiles by owner: each user reads only their own
--            rows and cannot update/delete the other's.
--   FR-002 — a user is capped at exactly two profiles: a third slot value fails
--            the CHECK and a duplicate (user_id, slot) fails the UNIQUE.
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

-- Seed one profile (slot 1) per user. Done as superuser (RLS bypassed) with an
-- explicit user_id, since the auth.uid() default would be NULL outside a request.
insert into public.viewer_profiles (user_id, slot, display_name) values
  ('11111111-1111-1111-1111-111111111111', 1, 'A slot 1'),
  ('22222222-2222-2222-2222-222222222222', 1, 'B slot 1');

select plan(10);

-- User A sees only their own profile.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.viewer_profiles)::int,
  1,
  'user A sees exactly one profile'
);
select is(
  (select user_id from public.viewer_profiles),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the profile user A sees is user A''s own'
);
select is(
  (select count(*) from public.viewer_profiles where user_id = '22222222-2222-2222-2222-222222222222'::uuid)::int,
  0,
  'user A cannot see user B''s profile'
);
reset role;

-- User B sees only their own profile.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.viewer_profiles)::int,
  1,
  'user B sees exactly one profile'
);
select is(
  (select display_name from public.viewer_profiles),
  'B slot 1',
  'the profile user B sees is user B''s own'
);
reset role;

-- User A attempts to tamper with user B's profile; RLS must filter both out
-- (no error, zero rows affected).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.viewer_profiles set display_name = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
delete from public.viewer_profiles where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
reset role;

-- Confirm user B's profile survived untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.viewer_profiles)::int,
  1,
  'user B''s profile survived user A''s cross-user delete attempt'
);
select is(
  (select display_name from public.viewer_profiles),
  'B slot 1',
  'user B''s profile is unchanged after user A''s cross-user write attempts'
);
reset role;

-- Slot cap (FR-002), exercised as user A who already owns slot 1.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- A second slot is allowed.
select lives_ok(
  $$ insert into public.viewer_profiles (slot, display_name) values (2, 'A slot 2') $$,
  'user A can create a second profile (slot 2)'
);
-- A third slot value violates the CHECK (slot in (1,2)).
select throws_ok(
  $$ insert into public.viewer_profiles (slot, display_name) values (3, 'A slot 3') $$,
  '23514',
  null,
  'a third slot value is rejected by the CHECK constraint'
);
-- A duplicate (user_id, slot) violates the UNIQUE constraint.
select throws_ok(
  $$ insert into public.viewer_profiles (slot, display_name) values (1, 'A slot 1 dup') $$,
  '23505',
  null,
  'a duplicate slot is rejected by the UNIQUE constraint'
);
reset role;

select * from finish();

rollback;

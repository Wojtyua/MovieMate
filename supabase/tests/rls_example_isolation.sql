-- Own-data isolation check for the canonical RLS pattern (run via `npm run db:verify`).
--
-- Proves RLS actually partitions data by owner — not merely that policies exist:
--   * two users each insert one row;
--   * each user reads exactly their own row and cannot see the other's;
--   * cross-user UPDATE/DELETE attempts silently affect nothing (RLS filters them).
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

-- Seed one row per user. Done as superuser (RLS bypassed) with explicit user_id,
-- since the auth.uid() default would be NULL outside an authenticated request.
insert into public.rls_example (user_id, note) values
  ('11111111-1111-1111-1111-111111111111', 'A note'),
  ('22222222-2222-2222-2222-222222222222', 'B note');

select plan(7);

-- User A sees only their own row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.rls_example)::int,
  1,
  'user A sees exactly one row'
);
select is(
  (select user_id from public.rls_example),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the row user A sees is user A''s own'
);
select is(
  (select count(*) from public.rls_example where user_id = '22222222-2222-2222-2222-222222222222'::uuid)::int,
  0,
  'user A cannot see user B''s row'
);
reset role;

-- User B sees only their own row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.rls_example)::int,
  1,
  'user B sees exactly one row'
);
select is(
  (select user_id from public.rls_example),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'the row user B sees is user B''s own'
);
reset role;

-- User A attempts to tamper with user B's row; RLS must filter both out (no error,
-- zero rows affected).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.rls_example set note = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
delete from public.rls_example where user_id = '22222222-2222-2222-2222-222222222222'::uuid;
reset role;

-- Confirm user B's row survived untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.rls_example)::int,
  1,
  'user B''s row survived user A''s cross-user delete attempt'
);
select is(
  (select note from public.rls_example),
  'B note',
  'user B''s row is unchanged after user A''s cross-user write attempts'
);
reset role;

select * from finish();

rollback;

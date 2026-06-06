-- Remembered taste core (S-01): collapse the two-slot viewer_profiles model into
-- one remembered taste core per user — stable preferred + excluded genres only.
--
-- This is a destructive reshape on dev-only data (per S-01 decision: existing
-- two-slot rows are wiped, no row-preserving backfill). Forward-only — there is
-- deliberately no down-migration that resurrects two slots.
--
-- Ordering matters: the unique(user_id) constraint cannot be added while a user
-- still owns two slot rows, so we wipe first, then drop the slot column (which
-- also removes the slot CHECK and the unnamed unique(user_id, slot) constraint
-- that involve it), then add the new owner-level uniqueness. The four owner-scoped
-- RLS policies, `enable row level security`, and viewer_profiles_user_id_idx are
-- left untouched.

-- 1. Wipe existing two-slot dev rows so the new unique(user_id) can be added.
delete from public.viewer_profiles;

-- 2. Drop the pair-shaped columns. Dropping `slot` automatically removes both the
--    `slot in (1,2)` CHECK and the unnamed `unique (user_id, slot)` constraint —
--    both involve only table-internal columns, so no CASCADE is needed.
alter table public.viewer_profiles
  drop column slot,
  drop column display_name,
  drop column note;

-- 3. One remembered taste core per user. Upserts now target this constraint via
--    on conflict (user_id).
alter table public.viewer_profiles
  add constraint viewer_profiles_user_id_key unique (user_id);

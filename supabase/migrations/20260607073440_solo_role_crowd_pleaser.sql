-- Widen the recommendation_picks role CHECK to admit the solo middle role
-- `crowd_pleaser` (S-02, FR-009). The solo role set is safe / crowd_pleaser /
-- wild_card; the duo `compromise` role stays valid because S-03 reintroduces
-- the two-viewer flow.
--
-- Additive and reversible: no data movement, no rows invalidated (every existing
-- role remains in the domain). Reversible by re-narrowing the CHECK while no
-- crowd_pleaser rows exist.
--
-- The original inline column CHECK was auto-named recommendation_picks_role_check;
-- drop it by that name and re-add it explicitly named so the domain is legible.

alter table public.recommendation_picks
  drop constraint recommendation_picks_role_check;

alter table public.recommendation_picks
  add constraint recommendation_picks_role_check
  check (role in ('safe', 'compromise', 'wild_card', 'crowd_pleaser'));

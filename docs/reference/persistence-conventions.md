# Persistence Conventions

How we add database tables in this repo. Every table follows the **owner-scoped RLS**
pattern so FR-001 ("a user can access only their own data") is enforced at the data
layer — not re-derived per feature. The canonical, executable template lives in
`supabase/migrations/20260530165958_rls_convention_example.sql` (the `rls_example`
reference table) and is proven by `supabase/tests/rls_example_isolation.sql`.

> `rls_example` is a **reference artifact, not a product table**. Product entities
> (viewer profiles, sessions/preferences, watched-dedup) each ship with their
> consuming slice. A later change may drop `rls_example` once a real table
> demonstrates the pattern.

## Why this works with zero client changes

`src/lib/supabase.ts` builds a per-request client with the **anon key + the user's
cookie JWT**. PostgREST therefore runs every query **as the authenticated user**, so
`auth.uid()`-based policies are enforced the moment a table exists. No typed wrapper or
client change is needed to get RLS — only schema, tooling, and this convention.

The runtime is Cloudflare **workerd**: data access stays over HTTP/PostgREST (no raw
`pg` TCP). The existing client already complies.

## Owner column rule

Every owner-scoped table carries:

```sql
user_id uuid not null references auth.users (id) on delete cascade default auth.uid()
```

- `references auth.users (id)` — ties ownership to the real auth user.
- `on delete cascade` — rows are cleaned up when the user is deleted.
- `default auth.uid()` — clients can insert without supplying `user_id`; the value comes
  from their JWT. **The default is ergonomics, not security** — the insert policy's
  `with check` is what actually prevents inserting rows owned by someone else.
- Index `user_id` (`create index <table>_user_id_idx on ... (user_id)`) — RLS predicates
  filter on it on every request.

## RLS policy template

Enabling RLS is **deny-by-default**: with RLS on and no policies, all access by roles
subject to RLS (`anon` / `authenticated` — the roles PostgREST uses) is blocked. The table
owner and superusers _bypass_ RLS unless `force row level security` is set, but PostgREST
never connects as the owner. Create the policies in the **same migration**
or access breaks. Use four per-command policies scoped by `auth.uid() = user_id`:

```sql
alter table public.<table> enable row level security;

create policy "<table>_select_own" on public.<table>
  for select using (auth.uid() = user_id);

create policy "<table>_insert_own" on public.<table>
  for insert with check (auth.uid() = user_id);

create policy "<table>_update_own" on public.<table>
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "<table>_delete_own" on public.<table>
  for delete using (auth.uid() = user_id);
```

- `select`/`delete` use `using` (which existing rows are visible/removable).
- `insert` uses `with check` (which new rows are allowed).
- `update` uses **both** `using` (which rows can be targeted) and `with check` (so a user
  cannot reassign ownership to someone else).

## Local migration workflow

Requires Docker running (the local Supabase stack). Scripts are in `package.json`:

| Command                 | Does                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `npm run db:start`      | Start the local Supabase stack (Docker).                        |
| `npm run db:stop`       | Stop the local stack.                                           |
| `npm run db:new <name>` | Scaffold a new timestamped migration in `supabase/migrations/`. |
| `npm run db:reset`      | Recreate the local DB and re-apply all migrations + `seed.sql`. |
| `npm run db:verify`     | Run the pgTAP tests in `supabase/tests/` (`supabase test db`).  |

Migrations are plain SQL in `supabase/migrations/<timestamp>_<name>.sql`, applied in
filename order. Seed data goes in `supabase/seed.sql` (loaded after migrations on reset).

### Verifying isolation (the test must have teeth)

`supabase/tests/rls_example_isolation.sql` is a pgTAP fixture that impersonates two users
and asserts each sees only their own row and cannot tamper with the other's. Impersonation
is mandatory because the `postgres`/superuser role and the table owner **bypass RLS** — a
test run as the default role proves nothing:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';
-- ...assertions run as that user...
reset role;
```

The whole fixture runs inside one transaction that rolls back, so `db:verify` is
idempotent (re-runnable without `db:reset`). To confirm a new table's test has teeth:
drop one of its policies, run `db:verify` (it should fail), then `db:reset` to restore.

The fixtures seed users with `insert into auth.users (id) ...`, relying on `id` being the
only NOT-NULL column without a default on the current Postgres image. After a
`supabase`/Postgres image bump, re-check the required `auth.users` columns (a new mandatory
column will fail the insert) and update the fixtures' setup accordingly.

## Remote application (human-gated)

Pushing schema to the **hosted** project is **not automated** — schema-destructive remote
ops are human-only (see `context/foundation/infrastructure.md`). The `rls_example`
reference table must **never** be pushed to production. When a real table is ready, a human
runs:

```bash
npx supabase link --project-ref <project-ref>   # one-time
npx supabase db push                             # apply local migrations to remote
```

There is intentionally no `db:push` npm script.

## New-table checklist

1. `npm run db:new <table_name>` — scaffold the migration.
2. Define the table with the **owner column** (`user_id uuid ... default auth.uid()`),
   a primary key, and `created_at timestamptz not null default now()`.
3. Add `create index <table>_user_id_idx on public.<table> (user_id);`.
4. `alter table ... enable row level security;`.
5. Add the **four** per-command policies from the template above.
6. Add a pgTAP isolation test under `supabase/tests/` mirroring
   `rls_example_isolation.sql` (impersonate two users; assert partitioned visibility).
7. `npm run db:reset && npm run db:verify` — both must pass.
8. Confirm teeth: drop a policy, re-verify (expect fail), `db:reset` to restore.

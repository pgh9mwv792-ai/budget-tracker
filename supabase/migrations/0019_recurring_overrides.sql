-- ---------------------------------------------------------------------------
-- 0019_recurring_overrides.sql
--
-- User curation for the subscription / recurring-charge detection. Detection is
-- automatic (src/lib/analysis.js → analyzeRecurring), but the user gets the
-- final say per merchant:
--   * status 'confirmed'      → always show this group, even if its cadence
--                               confidence is marginal (e.g. only two charges).
--   * status 'not_recurring'  → never treat this merchant as recurring; it is
--                               excluded from the Subscriptions view, the
--                               dashboard card, and the weekly digest.
--   * nickname                → a friendly display name that overrides the raw
--                               merchant text ("PLANET FIT CLUB FEE" → "Gym").
--
-- Keyed by (user_id, merchant_key) where merchant_key is the normalized note
-- (see merchantKey() in src/lib/analysis.js), the same key merchant_rules uses.
--
-- Standard user-owned RLS. Idempotent and additive: safe to run (or re-run).
-- ---------------------------------------------------------------------------

create table if not exists recurring_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  status text not null check (status in ('confirmed', 'not_recurring')),
  nickname text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);

alter table recurring_overrides enable row level security;

-- Owned-by-user policy. Guarded so re-running doesn't error.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'recurring_overrides'
      and policyname = 'recurring_overrides are owned by user'
  ) then
    create policy "recurring_overrides are owned by user"
      on recurring_overrides for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

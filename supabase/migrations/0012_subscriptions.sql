-- ---------------------------------------------------------------------------
-- 0012_subscriptions.sql
--
-- Paid-tier scaffolding (Phase 2.1). Adds one row per user describing their
-- Stripe subscription state, plus a single get_entitlements() function the
-- frontend and edge functions both call to decide free vs. pro.
--
-- SECURITY MODEL
--   * A user may READ their own subscription row (normal owned-by-user RLS).
--   * NOBODY may insert/update/delete via the API — there are deliberately no
--     write policies. Only the service-role key (used inside the Stripe edge
--     functions, which bypasses RLS) writes here, after verifying the Stripe
--     webhook signature. This mirrors how plaid_items is protected: the client
--     can never fake itself into a paid plan.
--
-- Idempotent and additive: safe to run (or re-run) on the live database.
-- ---------------------------------------------------------------------------

create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  -- Stripe's subscription status ('active', 'trialing', 'past_due',
  -- 'canceled', ...) or our own 'grandfathered' for accounts that predate
  -- billing and get Pro for free.
  status text,
  -- When the current paid period ends. While this is in the future and the
  -- status is active/trialing, the user stays Pro — so a cancellation (which
  -- keeps status active until this date) correctly downgrades only at period end.
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- Read-your-own-row policy. Guarded so re-running doesn't error.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and policyname = 'subscriptions_select_own'
  ) then
    create policy subscriptions_select_own
      on subscriptions for select
      using (auth.uid() = user_id);
  end if;
end $$;
-- No insert/update/delete policies on purpose: writes are service-role only.

-- ---------------------------------------------------------------------------
-- get_entitlements(): the single source of truth for the current user's plan.
-- Always returns exactly one row (even when the user has no subscription row
-- yet) so the caller never has to special-case "no data". The left join off a
-- one-row anchor guarantees that.
-- ---------------------------------------------------------------------------
create or replace function get_entitlements()
returns table (plan text, status text, period_end timestamptz)
language sql
security definer
set search_path = public
as $$
  select
    case
      -- Grandfathered accounts are Pro forever, no Stripe subscription needed.
      when s.status = 'grandfathered' then 'pro'
      -- Active/trialing and still within the paid period => Pro.
      when s.status in ('active', 'trialing')
           and (s.current_period_end is null or s.current_period_end > now())
        then 'pro'
      else 'free'
    end as plan,
    s.status,
    s.current_period_end as period_end
  from (select auth.uid() as uid) me
  left join subscriptions s on s.user_id = me.uid;
$$;

revoke all on function get_entitlements() from public;
grant execute on function get_entitlements() to authenticated;

-- ---------------------------------------------------------------------------
-- Grandfather the existing owner so billing never locks them out of their own
-- app. Matches by email (the account that built the app) and does nothing if a
-- row already exists, so this is safe to re-run.
-- ---------------------------------------------------------------------------
insert into subscriptions (user_id, status)
select id, 'grandfathered'
from auth.users
where email = 'cedarhale@icloud.com'
on conflict (user_id) do nothing;

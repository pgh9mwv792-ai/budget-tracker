-- ---------------------------------------------------------------------------
-- 0015_digest_prefs.sql
--
-- Phase 4 (Proactive weekly digest). Adds:
--   * notification_prefs — one row per user; whether they want the weekly
--     digest email and (optionally) a different address to send it to.
--   * digests — the rendered weekly digest, stored so the app can also show it
--     in-app as a dismissible card. Written only by the weekly-digest edge
--     function (service role); the user can read and dismiss their own.
--
-- SECURITY MODEL
--   * notification_prefs: normal owned-by-user RLS (the user manages their own
--     preferences from Settings).
--   * digests: the user may READ and UPDATE (to dismiss) their own rows, but may
--     NOT insert — new digests are written only by the service-role edge
--     function, mirroring how subscriptions/plaid_items are protected.
--
-- Idempotent and additive: safe to run (or re-run) on the live database.
-- ---------------------------------------------------------------------------

-- ---------- notification_prefs ----------
-- Absence of a row means "defaults" (digest on), so the edge function treats a
-- missing row as opted-in and only skips when weekly_digest is explicitly false.
create table if not exists notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly_digest boolean not null default true,
  -- Optional address to send the digest to instead of the account email.
  email_override text,
  updated_at timestamptz not null default now()
);

alter table notification_prefs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_prefs'
      and policyname = 'notification_prefs_owned'
  ) then
    create policy notification_prefs_owned
      on notification_prefs for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ---------- digests ----------
create table if not exists digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The Monday-ish start of the 7-day window the digest covers. Unique per user
  -- so re-running the cron in the same week updates the row instead of piling up.
  week_start date not null,
  subject text not null,
  -- Friendly plain-text body (the LLM rewrite, or the deterministic text if the
  -- rewrite failed). This is what the in-app card renders.
  summary text not null,
  -- Structured sections [{ key, title, body }] for optional richer in-app display.
  sections jsonb not null default '[]'::jsonb,
  -- The rendered email HTML, kept for reference/debugging.
  html text,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

alter table digests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'digests' and policyname = 'digests_select_own'
  ) then
    create policy digests_select_own
      on digests for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'digests' and policyname = 'digests_update_own'
  ) then
    -- Lets the frontend flip `dismissed` to true. No insert/delete policies on
    -- purpose: only the service-role edge function creates digest rows.
    create policy digests_update_own
      on digests for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists digests_user_week_idx on digests (user_id, week_start desc);

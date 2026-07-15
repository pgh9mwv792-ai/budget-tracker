-- ---------------------------------------------------------------------------
-- 0031_calendar.sql
--
-- The Calendar feature: work shifts, paydays, bills, and one-off events in one
-- place. Three user-owned tables:
--
--   * income_sources  — an employer / income stream: hourly rate, pay cadence,
--                       and a known "anchor" payday that future paydays derive
--                       from. Also holds a per-employer "close time" answer so
--                       the AI schedule parser doesn't have to ask twice.
--   * schedule_rules  — a recurring pattern ("I work Tue–Fri 3pm–9:30pm"). A
--                       rule materializes into concrete calendar_events rows.
--   * calendar_events — the concrete instances shown on the grid. Shifts/events
--                       come from a rule (rule_id) or manual entry; bills and
--                       paydays are rendered live from Plaid-derived data and
--                       are NOT stored here.
--
-- Recurrence model: creating a rule generates calendar_events 8 weeks forward
-- (see src/lib/materialize.js). Editing a single instance sets is_exception=true
-- (or status='cancelled') on that one row and never touches the rule.
--
-- Standard user-owned RLS. Idempotent and additive: safe to run (or re-run).
-- ---------------------------------------------------------------------------

-- ---------- income_sources ----------
create table if not exists income_sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  hourly_rate   numeric(8, 2),
  pay_frequency text check (pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  pay_anchor    date,              -- a known payday; future paydays derive from this
  close_time    time,              -- persisted answer to "what time is close?" (per employer)
  created_at    timestamptz not null default now()
);

alter table income_sources enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'income_sources'
      and policyname = 'income_sources are owned by user'
  ) then
    create policy "income_sources are owned by user"
      on income_sources for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ---------- schedule_rules ----------
create table if not exists schedule_rules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  income_source_id uuid references income_sources(id) on delete set null,
  kind             text not null check (kind in ('shift', 'event')),
  title            text,
  days_of_week     int[] not null,          -- 0=Sun..6=Sat
  start_time       time not null,
  end_time         time not null,
  starts_on        date not null,
  ends_on          date,                     -- null = repeats indefinitely
  source           text not null default 'ai' check (source in ('ai', 'manual')),
  raw_input        text,                     -- original user text, or 'screenshot' + AI transcription
  created_at       timestamptz not null default now()
);

alter table schedule_rules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'schedule_rules'
      and policyname = 'schedule_rules are owned by user'
  ) then
    create policy "schedule_rules are owned by user"
      on schedule_rules for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ---------- calendar_events ----------
create table if not exists calendar_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  rule_id          uuid references schedule_rules(id) on delete cascade,
  income_source_id uuid references income_sources(id) on delete set null,
  kind             text not null check (kind in ('shift', 'event', 'bill', 'payday')),
  title            text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  status           text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  is_exception     boolean not null default false,   -- instance hand-edited off its rule
  amount           numeric(10, 2),                   -- bill amount / projected pay / computed shift gross
  external_id      text,                             -- link to existing bill/recurring-txn id
  created_at       timestamptz not null default now()
);

alter table calendar_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_events'
      and policyname = 'calendar_events are owned by user'
  ) then
    create policy "calendar_events are owned by user"
      on calendar_events for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists calendar_events_user_start_idx on calendar_events (user_id, starts_at);
create index if not exists calendar_events_rule_idx on calendar_events (rule_id);

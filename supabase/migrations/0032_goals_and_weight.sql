-- ---------------------------------------------------------------------------
-- 0032: unified goals (financial + fitness) + body stats + weight log.
--
-- Three parts, all additive & idempotent (safe to run or re-run on the live DB):
--   1) profiles      — new: per-user body stats (height) + unit preference.
--   2) weight_logs   — new: one weigh-in per day (stored in kg), quick-log
--                      upserts on the (user_id, logged_on) unique key.
--   3) goals         — RESHAPED IN PLACE. The old savings-goal columns
--                      (name/target_amount/current_amount) are preserved and
--                      back-filled into the new generic shape, so no data is
--                      lost and the old rows keep working. New columns describe
--                      every goal — financial OR fitness — with one schema:
--                      {type, title, start_value, target_value, direction,
--                       deadline, tracking, source_ref, current_value, status}.
--
-- Why additive (not a drop/recreate): this app's guardrail is "prefer additive,
-- low-risk edits". The old NOT NULL columns are made nullable so new-shape
-- inserts don't need them, but they're left in place holding the migrated data.
-- ---------------------------------------------------------------------------

-- ============================ 1) profiles ==================================
-- One row per user. Absence of a row means "not onboarded yet" (height null),
-- which the Goals tab uses to show its inline body-stats prompt.
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  height_cm numeric,
  unit_preference text not null default 'imperial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Guard the unit choice. Added separately so re-running doesn't error if present.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_unit_preference_check') then
    alter table profiles
      add constraint profiles_unit_preference_check
      check (unit_preference in ('imperial', 'metric'));
  end if;
end $$;

alter table profiles enable row level security;

drop policy if exists "profiles are owned by user" on profiles;
create policy "profiles are owned by user"
  on profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================ 2) weight_logs ===============================
-- Weight ALWAYS stored in kilograms; the app converts to lb/kg at the display
-- layer per the user's unit_preference. One entry per calendar day: the unique
-- (user_id, logged_on) key lets the quick-log button upsert instead of erroring.
create table if not exists weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_kg numeric not null,
  logged_on date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, logged_on)
);

alter table weight_logs enable row level security;

drop policy if exists "weight_logs are owned by user" on weight_logs;
create policy "weight_logs are owned by user"
  on weight_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists weight_logs_user_date_idx
  on weight_logs (user_id, logged_on desc);

-- ============================ 3) goals reshape =============================
-- Add the generic columns. Defaults keep the migration valid against existing
-- rows (every old goal becomes an active, manual, increasing financial goal).
alter table goals add column if not exists type text not null default 'financial';
alter table goals add column if not exists title text;
alter table goals add column if not exists start_value numeric not null default 0;
alter table goals add column if not exists target_value numeric;
alter table goals add column if not exists direction text not null default 'increase';
alter table goals add column if not exists deadline date;
alter table goals add column if not exists tracking text not null default 'manual';
alter table goals add column if not exists source_ref jsonb;
alter table goals add column if not exists current_value numeric;
alter table goals add column if not exists status text not null default 'active';

-- Back-fill the new columns from the old savings-goal columns, but only where
-- they haven't been set yet (so re-running never clobbers real data).
update goals set title = name where title is null and name is not null;
update goals set target_value = target_amount where target_value is null and target_amount is not null;
update goals set current_value = current_amount where current_value is null and current_amount is not null;

-- Old columns become optional so new-shape inserts (which don't set them) work.
alter table goals alter column name drop not null;
alter table goals alter column target_amount drop not null;
alter table goals alter column current_amount drop not null;

-- Enforce the allowed value sets. Each guarded so re-running is a no-op.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_type_check') then
    alter table goals add constraint goals_type_check
      check (type in ('financial', 'fitness'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_direction_check') then
    alter table goals add constraint goals_direction_check
      check (direction in ('increase', 'decrease'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_tracking_check') then
    alter table goals add constraint goals_tracking_check
      check (tracking in ('auto', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_status_check') then
    alter table goals add constraint goals_status_check
      check (status in ('active', 'completed', 'archived'));
  end if;
end $$;

create index if not exists goals_user_status_idx on goals (user_id, status);

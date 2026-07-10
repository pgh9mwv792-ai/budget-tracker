-- ---------------------------------------------------------------------------
-- 0028_meal_templates.sql
--
-- Saved meals ("my usual breakfast"). A template is a named bundle of food
-- snapshots the user eats repeatedly, so they can log the whole thing in one
-- tap instead of re-adding each item every day. Two pieces:
--
--   * meal_templates      — one row per saved meal. `items` is a jsonb array of
--     food snapshots (each: food_id, name, servings, calories, protein, carbs,
--     fat, cost — the same per-serving numbers a food_log carries), so a
--     template stays stable even if the underlying library food is later edited
--     or deleted. `meal` is the section it files under (breakfast/…); nullable
--     = Uncategorized. `scheduled_days` is a set of weekday numbers (0=Sun … 6=
--     Sat) on which the app surfaces a "planned" card prompting the user to
--     confirm-log it — it NEVER logs on its own unless `auto_log` is opted in.
--
--   * food_logs.template_id — which template produced a log, so "already logged
--     my usual breakfast today" is a reliable query (and a planned card can hide
--     itself once confirmed). ON DELETE SET NULL: deleting a template leaves the
--     meals it created intact, just unlinked.
--
-- SECURITY MODEL: normal owned-by-user RLS (auth.uid() = user_id). A template is
-- the user's own data; nothing here is service-role-only.
--
-- Idempotent and additive: safe to run (or re-run) on the live database.
-- ---------------------------------------------------------------------------

create table if not exists meal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- The meal section this files under when logged. Null = Uncategorized. Mirrors
  -- food_logs.meal (breakfast/lunch/dinner/snack/supplement or null).
  meal text,
  -- Array of food snapshots; see header. Empty array is allowed but pointless.
  items jsonb not null default '[]'::jsonb,
  -- Weekday numbers (0=Sunday … 6=Saturday) this template is "planned" on. Empty
  -- = not scheduled (still one-tap loggable, just no planned card).
  scheduled_days smallint[] not null default '{}',
  -- Opt-in: when true, the app may log this template automatically on its
  -- scheduled days without a confirmation tap. Default false = always confirm.
  auto_log boolean not null default false,
  created_at timestamptz not null default now()
);

alter table meal_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meal_templates' and policyname = 'meal_templates are owned by user'
  ) then
    create policy "meal_templates are owned by user"
      on meal_templates for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists meal_templates_user_idx on meal_templates (user_id, created_at desc);

-- Which template (if any) produced a food log. Nullable; on delete set null so
-- deleting a template never deletes the meals it created.
alter table food_logs add column if not exists template_id uuid references meal_templates(id) on delete set null;

-- Fast "did this template already get logged on this date" lookup.
create index if not exists food_logs_template_idx
  on food_logs (template_id, date)
  where template_id is not null;

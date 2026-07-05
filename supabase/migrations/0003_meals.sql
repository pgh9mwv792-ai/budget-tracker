-- Budget tracker: meal / macro tracker with budgeting integration
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER 0002.

-- ---------- foods (reusable library of foods with per-serving macros) ----------
create table if not exists foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  serving_desc text,                       -- e.g. "6 oz", "1 cup", "1 scoop"
  calories numeric(10, 2) not null default 0,
  protein numeric(10, 2) not null default 0,
  carbs numeric(10, 2) not null default 0,
  fat numeric(10, 2) not null default 0,
  cost numeric(10, 2),                      -- optional typical cost per serving
  created_at timestamptz not null default now()
);

alter table foods enable row level security;

create policy "foods are owned by user"
  on foods for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- food_logs (a food eaten on a day) ----------
-- Macros are snapshotted at log time so past days stay accurate even if the
-- food's library entry is later edited or deleted. Values are PER SERVING;
-- multiply by servings for totals.
create table if not exists food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  food_id uuid references foods(id) on delete set null,
  date date not null,
  meal text not null default 'snack' check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name text not null,
  servings numeric(8, 2) not null default 1,
  calories numeric(10, 2) not null default 0,
  protein numeric(10, 2) not null default 0,
  carbs numeric(10, 2) not null default 0,
  fat numeric(10, 2) not null default 0,
  cost numeric(10, 2),
  created_at timestamptz not null default now()
);

alter table food_logs enable row level security;

create policy "food_logs are owned by user"
  on food_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists food_logs_user_date_idx on food_logs (user_id, date desc);

-- ---------- nutrition_targets (one row per user) ----------
create table if not exists nutrition_targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calories numeric(10, 2) not null default 0,
  protein numeric(10, 2) not null default 0,
  carbs numeric(10, 2) not null default 0,
  fat numeric(10, 2) not null default 0,
  updated_at timestamptz not null default now()
);

alter table nutrition_targets enable row level security;

create policy "nutrition_targets are owned by user"
  on nutrition_targets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

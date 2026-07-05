-- Budget tracker: auto-categorization rules + category budgets
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER 0001_init.sql.

-- ---------- merchant_rules ----------
-- Remembers "this merchant -> this category" so imported transactions can be
-- auto-categorized. merchant_key is a normalized form of the transaction note
-- (see src/lib/analysis.js merchantKey()).
create table if not exists merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  category_id uuid not null references categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);

alter table merchant_rules enable row level security;

create policy "merchant_rules are owned by user"
  on merchant_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- budgets ----------
-- One monthly spending limit per (expense) category. current-month spending is
-- computed on the client from transactions, so we only store the limit here.
create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, category_id)
);

alter table budgets enable row level security;

create policy "budgets are owned by user"
  on budgets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

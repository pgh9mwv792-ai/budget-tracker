-- Budget tracker schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

-- ---------- categories ----------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income', 'expense')),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table categories enable row level security;

create policy "categories are owned by user"
  on categories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- transactions ----------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  date date not null,
  amount numeric(12, 2) not null,
  kind text not null check (kind in ('income', 'expense')),
  note text,
  source text not null default 'manual' check (source in ('manual', 'plaid')),
  plaid_transaction_id text unique,
  created_at timestamptz not null default now()
);

alter table transactions enable row level security;

create policy "transactions are owned by user"
  on transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists transactions_user_date_idx on transactions (user_id, date desc);
create index if not exists transactions_uncategorized_idx on transactions (user_id) where category_id is null;

-- ---------- goals ----------
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(12, 2) not null,
  current_amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table goals enable row level security;

create policy "goals are owned by user"
  on goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- plaid_items (one row per linked bank connection) ----------
create table if not exists plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null unique,
  access_token text not null,
  institution_name text,
  cursor text,
  created_at timestamptz not null default now()
);

alter table plaid_items enable row level security;

-- access_token must never be readable from the frontend. Only the service-role
-- key (used inside Edge Functions) bypasses RLS, so we deliberately do NOT
-- grant a select policy for regular users here.
-- No RLS policies are granted to the authenticated/anon roles here on
-- purpose: regular users (and therefore the frontend) can never read or
-- write plaid_items directly, so access_token can never leak to the
-- browser. Only the service-role key (used inside Edge Functions) can
-- touch this table, since it bypasses RLS entirely.

-- Frontend-safe way to list connected institutions, without exposing
-- access_token: a SECURITY DEFINER function that filters by auth.uid()
-- internally and only returns non-sensitive columns.
create or replace function get_plaid_connections()
returns table (id uuid, item_id text, institution_name text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, item_id, institution_name, created_at
  from plaid_items
  where user_id = auth.uid();
$$;

revoke all on function get_plaid_connections() from public;
grant execute on function get_plaid_connections() to authenticated;

-- Seed a few starter categories is left to the app on first login (see
-- src/lib/api.js ensureDefaultCategories) so each user gets their own set.

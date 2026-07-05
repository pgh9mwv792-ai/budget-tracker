-- ---------------------------------------------------------------------------
-- 0007: per-account balances (checking vs savings) + a 'transfer' kind so
-- internal money movements (e.g. savings -> checking) stop being miscounted
-- as income or expense.
-- ---------------------------------------------------------------------------

-- 1) Allow a third transaction kind: 'transfer'. Because every income/expense
--    calculation in the app filters on kind === 'income' / 'expense',
--    transfers automatically fall out of those totals once tagged this way.
alter table transactions drop constraint if exists transactions_kind_check;
alter table transactions
  add constraint transactions_kind_check
  check (kind in ('income', 'expense', 'transfer'));

-- 2) Remember which bank account each imported transaction belongs to, so we
--    can attribute activity to checking vs savings later if needed.
alter table transactions add column if not exists account_id text;

-- 3) One row per bank account (a single linked bank can expose several:
--    a checking, a savings, a credit card, etc.). Balances live here.
create table if not exists plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,                 -- which plaid_items connection this belongs to
  account_id text not null unique,       -- Plaid's stable account identifier
  name text,                             -- e.g. "Plaid Checking"
  official_name text,
  type text,                             -- depository, credit, loan, ...
  subtype text,                          -- checking, savings, credit card, ...
  mask text,                             -- last 4 digits
  current_balance numeric(14, 2),
  available_balance numeric(14, 2),
  iso_currency_code text,
  updated_at timestamptz not null default now()
);

alter table plaid_accounts enable row level security;

-- Like plaid_items, we do NOT grant any RLS policy to regular users. The
-- frontend reads accounts through the SECURITY DEFINER function below, which
-- exposes only the non-sensitive columns. Only the service-role key (used in
-- Edge Functions) can write here.

create or replace function get_plaid_accounts()
returns table (
  account_id text,
  item_id text,
  name text,
  official_name text,
  type text,
  subtype text,
  mask text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select account_id, item_id, name, official_name, type, subtype, mask,
         current_balance, available_balance, iso_currency_code, updated_at
  from plaid_accounts
  where user_id = auth.uid();
$$;

revoke all on function get_plaid_accounts() from public;
grant execute on function get_plaid_accounts() to authenticated;

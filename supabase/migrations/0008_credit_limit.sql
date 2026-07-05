-- ---------------------------------------------------------------------------
-- 0008: store each credit account's limit, so we can show balance, limit, and
-- utilization (balance / limit) for credit cards.
-- ---------------------------------------------------------------------------

alter table plaid_accounts add column if not exists credit_limit numeric(14, 2);

-- The return type changes (new column), so we must drop before recreating.
drop function if exists get_plaid_accounts();

create function get_plaid_accounts()
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
  credit_limit numeric,
  iso_currency_code text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select account_id, item_id, name, official_name, type, subtype, mask,
         current_balance, available_balance, credit_limit, iso_currency_code, updated_at
  from plaid_accounts
  where user_id = auth.uid();
$$;

revoke all on function get_plaid_accounts() from public;
grant execute on function get_plaid_accounts() to authenticated;

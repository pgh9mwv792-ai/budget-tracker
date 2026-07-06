-- ---------------------------------------------------------------------------
-- 0016_receipt_items.sql
--
-- Receipt itemization. Connects two existing systems (receipt scanning + Plaid
-- transactions) and extends a third (the foods library). Adds:
--   * receipts          — one row per scanned itemized receipt. Links to the
--     Plaid/manual transaction that is the actual money record.
--   * receipt_items      — one row per printed line item, kept VERBATIM as the
--     rules table keys off the raw text. Optionally mapped to a library food.
--   * receipt_item_rules — the receipt-item equivalent of merchant_rules:
--     remembers "365 ORG CHKN BRST" → the user's chicken-breast food so a
--     re-scan of the same item auto-suggests the mapping.
--
-- SECURITY MODEL
--   All three tables are normal owned-by-user RLS (auth.uid() = user_id).
--   Nothing here is service-role-only — the receipt is the user's own data.
--
-- Idempotent and additive: safe to run (or re-run) on the live database.
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER 0015.
-- ---------------------------------------------------------------------------

-- ---------- receipts ----------
create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_name text,
  purchase_date date,
  total numeric(12, 2),
  -- The transaction this receipt itemizes. When a scan matches a Plaid row, the
  -- Plaid row stays the money record and the receipt just annotates it — no
  -- duplicate transaction is created. Nullable so a receipt can exist briefly
  -- before it is linked. ON DELETE SET NULL so deleting a transaction doesn't
  -- silently drop the itemization.
  matched_transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table receipts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'receipts' and policyname = 'receipts are owned by user'
  ) then
    create policy "receipts are owned by user"
      on receipts for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists receipts_user_idx on receipts (user_id, purchase_date desc);
-- One receipt per transaction: a Plaid/manual row can only be claimed once.
create unique index if not exists receipts_matched_txn_idx
  on receipts (matched_transaction_id)
  where matched_transaction_id is not null;

-- ---------- receipt_items ----------
-- raw_name is kept EXACTLY as printed on the receipt — the rules table normalizes
-- it into a key, but the verbatim text must survive so a re-scan matches.
create table if not exists receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_name text not null,
  price numeric(12, 2),
  quantity numeric,
  unit text,                                 -- lb / oz / each, or null
  is_food boolean not null default true,
  food_id uuid references foods(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table receipt_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'receipt_items' and policyname = 'receipt_items are owned by user'
  ) then
    create policy "receipt_items are owned by user"
      on receipt_items for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists receipt_items_receipt_idx on receipt_items (receipt_id);

-- ---------- receipt_item_rules ----------
-- item_key is a normalized form of raw_name (see src/lib/receiptMatch.js itemKey()).
create table if not exists receipt_item_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  food_id uuid not null references foods(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, item_key)
);

alter table receipt_item_rules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'receipt_item_rules' and policyname = 'receipt_item_rules are owned by user'
  ) then
    create policy "receipt_item_rules are owned by user"
      on receipt_item_rules for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

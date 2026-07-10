-- ---------------------------------------------------------------------------
-- 0029_transfer_pairs.sql
--
-- Transfer pairing. When you move money between two accounts you own — a
-- savings -> checking transfer, or a credit-card PAYMENT (checking -> card) —
-- Plaid imports it as TWO separate transactions (one on each account), both
-- already classified kind='transfer' (see _shared/classify.ts). This table
-- LINKS those two legs so the UI can show them as a single combined row.
--
-- IMPORTANT: a pair is only a link. It never merges, edits, or deletes the two
-- underlying transactions — both rows persist untouched and keep counting (or
-- rather, keep being excluded from income/expense totals) exactly as before.
-- Unpairing just deletes the link row.
--
--   status = 'auto'      the matcher found an exact, confident match and linked
--                        it automatically.
--            'confirmed' the user confirmed a suspected match, or manually paired.
--
-- Normal owned-by-user RLS (auth.uid() = user_id). A leg belongs to at most one
-- pair — enforced by unique indexes on each transaction column.
--
-- Idempotent and additive: safe to run (or re-run) on the live database.
-- Run in the Supabase SQL editor (or via `supabase db push`) AFTER 0028.
-- ---------------------------------------------------------------------------

create table if not exists transfer_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The two legs. ON DELETE CASCADE: if either transaction is deleted, the link
  -- is meaningless, so drop it (the surviving leg simply becomes unpaired again).
  transaction_a uuid not null references transactions(id) on delete cascade,
  transaction_b uuid not null references transactions(id) on delete cascade,
  status text not null default 'auto' check (status in ('auto', 'confirmed')),
  created_at timestamptz not null default now(),
  -- A pair can't link a transaction to itself.
  check (transaction_a <> transaction_b)
);

alter table transfer_pairs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transfer_pairs' and policyname = 'transfer_pairs are owned by user'
  ) then
    create policy "transfer_pairs are owned by user"
      on transfer_pairs for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists transfer_pairs_user_idx on transfer_pairs (user_id);

-- Each transaction may belong to at most one pair, on EITHER side. Two unique
-- indexes (one per column) guarantee a leg can't be double-linked.
create unique index if not exists transfer_pairs_a_idx on transfer_pairs (transaction_a);
create unique index if not exists transfer_pairs_b_idx on transfer_pairs (transaction_b);

-- ---------------------------------------------------------------------------
-- 0009: manual credit-score log.
--
-- We CANNOT legally auto-pull a real credit score through Plaid (scores are
-- FCRA-regulated credit-bureau data). So instead the user types in the score
-- they already see for free elsewhere (Credit Karma, their bank, their card's
-- app), and we chart it over time and show the change.
--
-- The "what's affecting it" insight is computed separately in the app from the
-- credit-card balances/limits we already store in plaid_accounts — no extra
-- data lives here.
--
-- Like every other table, this is protected by row-level security: a score row
-- is only ever readable/writable by the user who created it. It holds nothing
-- sensitive — just a number, where it came from, and an optional note.
-- Run this in the Supabase SQL editor AFTER 0008.
-- ---------------------------------------------------------------------------

create table if not exists credit_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null check (score >= 300 and score <= 850),
  source text,
  recorded_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

alter table credit_scores enable row level security;

create policy "credit_scores are owned by user"
  on credit_scores for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists credit_scores_user_idx on credit_scores (user_id, recorded_on);

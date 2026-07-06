-- ---------------------------------------------------------------------------
-- 0018: link a food log to the bank transaction that paid for it, and let a
-- library food be marked as an ESTIMATE.
--
-- When the assistant logs a restaurant/fast-food meal, it can cross-reference
-- the user's transactions and attach the matching charge. `transaction_id` is
-- that link; the log's `cost` (added back in 0003) snapshots the amount so the
-- food-cost math stays accurate even if the transaction is later re-synced.
-- The link is also what stops the same dollar being counted twice: a log that
-- points at a transaction is money already in the transaction-spend total, so
-- day/weekly totals must not add its cost again (see foodCost.js).
--
-- `source = 'estimate'` marks a library food whose macros came from the
-- assistant's published-nutrition knowledge (a named chain item) rather than a
-- database record, so the UI can flag those numbers as approximate.
--
-- Idempotent: re-running is a no-op if already applied.
-- ---------------------------------------------------------------------------

alter table food_logs
  add column if not exists transaction_id uuid references transactions(id) on delete set null;

create index if not exists food_logs_transaction_idx
  on food_logs (transaction_id)
  where transaction_id is not null;

-- Extend the foods.source CHECK to allow 'estimate'. A CHECK can't be altered in
-- place, so drop the old constraint (from 0014) and re-add it with the wider set.
alter table foods drop constraint if exists foods_source_check;

do $$ begin
  alter table foods
    add constraint foods_source_check
    check (source in ('manual', 'usda', 'supplement_scan', 'receipt', 'estimate'));
exception
  when duplicate_object then null;
end $$;

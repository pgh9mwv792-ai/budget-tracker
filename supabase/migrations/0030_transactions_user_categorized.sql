-- Budget tracker: protect manual category edits from being overwritten by sync.
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER 0029.
--
-- Bug: a user re-categorizes a posted deposit (e.g. payroll → Income), but a
-- later Plaid sync/auto-categorization pass puts it back. This flag marks a
-- transaction whose category a human deliberately set, so:
--   * the Plaid sync's payroll auto-categorization skips it, and
--   * the pending→posted handoff carries the flag forward with the category.
-- Existing rows can't be told apart from auto-assigned ones, so they all start
-- false; the user re-categorizes once more after this ships and it then sticks.
alter table transactions
  add column if not exists user_categorized boolean not null default false;

-- ---------------------------------------------------------------------------
-- 0011_drop_plaintext_tokens.sql
--
-- Final step of encrypting Plaid tokens at rest: removes the old plaintext
-- access_token column now that every row is stored encrypted in
-- access_token_enc.
--
-- ⚠️  DO NOT RUN THIS until you have:
--   1. Run migration 0010.
--   2. Deployed the updated edge functions.
--   3. Run the plaid-encrypt-backfill function and confirmed it reported
--      "remaining_plaintext": 0.
--   4. Confirmed the safety check below returns zero rows.
--
-- Once the column is dropped there is no plaintext to fall back to, so an
-- un-encrypted row would break that bank connection permanently.
--
-- Run this in the Supabase SQL Editor AFTER the backfill is verified.
-- ---------------------------------------------------------------------------

-- Safety check: this must return 0. If it returns anything, STOP — a bank row
-- has no encrypted token yet. Re-run the backfill before continuing.
--   select count(*) from plaid_items
--   where access_token_enc is null and access_token is not null;

alter table plaid_items
  drop column if exists access_token;

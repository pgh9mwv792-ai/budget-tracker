-- ---------------------------------------------------------------------------
-- 0010_encrypt_plaid_tokens.sql
--
-- Encrypts Plaid bank access tokens at rest. Until now plaid_items.access_token
-- was stored in plaintext (protected only by RLS-with-no-policies, so it never
-- leaves the server). This adds a second, encrypted-at-rest column so that even
-- a raw dump of the table can't reveal a usable bank token.
--
-- HOW IT WORKS
--   * Edge Functions encrypt the token with AES-GCM (Web Crypto) before storing
--     it, using a 32-byte key held ONLY as the TOKEN_ENCRYPTION_KEY edge secret.
--   * The ciphertext lives in the new access_token_enc column.
--   * The old plaintext access_token column is kept FOR NOW so existing rows keep
--     working while we back-fill. A later migration (0011) drops it once every
--     row has been encrypted and verified. Do NOT drop it before then.
--
-- This migration is additive and safe to run on the live database: it does not
-- touch existing data. Run it in the Supabase SQL Editor AFTER 0009.
-- ---------------------------------------------------------------------------

-- New column holding the AES-GCM ciphertext (format: "v1:<iv b64>:<ct b64>").
alter table plaid_items
  add column if not exists access_token_enc text;

-- Allow rows created AFTER the cutover to store only the encrypted token
-- (access_token left null). Existing rows keep their plaintext until back-fill.
-- Dropping NOT NULL is safe to run repeatedly.
alter table plaid_items
  alter column access_token drop not null;

-- ---------------------------------------------------------------------------
-- 0027: give scanned/looked-up foods a `upc` column (barcode number).
--
-- When a packaged food is added by scanning its barcode, we record the UPC/EAN
-- so the same product is recognized (and deduped) the next time it's scanned,
-- rather than creating a second library row. Nullable free-text (digits as a
-- string, to preserve any leading zero) — hand-entered, generic, and label-only
-- foods leave it empty. Backward compatible; existing foods are untouched.
--
-- A plain (non-unique) index speeds the "do I already have this UPC?" lookup.
-- It is intentionally NOT unique: two users can own the same UPC, and a single
-- user could legitimately keep two rows for one code (e.g. a re-grade), so the
-- app dedupes in the client rather than the DB forbidding it.
--
-- Idempotent: re-running is a no-op if already applied.
-- ---------------------------------------------------------------------------

alter table foods
  add column if not exists upc text;

create index if not exists foods_user_upc_idx
  on foods (user_id, upc)
  where upc is not null;

-- Add 'barcode' to the foods.source CHECK — a food added by scanning its UPC,
-- resolved via Open Food Facts or USDA branded search (barcode-lookup function).
-- A CHECK can't be altered in place, so drop and re-add with the wider set
-- (mirrors 0023's approach). The OFF product page, when known, is kept in
-- `source_ref` for provenance; USDA-via-barcode hits also carry an fdc_id.
alter table foods drop constraint if exists foods_source_check;

do $$ begin
  alter table foods
    add constraint foods_source_check
    check (source in ('manual', 'usda', 'supplement_scan', 'receipt', 'estimate', 'label_scan', 'web', 'barcode'));
exception
  when duplicate_object then null;
end $$;

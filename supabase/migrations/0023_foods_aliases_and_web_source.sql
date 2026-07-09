-- ---------------------------------------------------------------------------
-- 0023: branded food capture — food aliases, web-sourced provenance, and two
-- new `source` values ('label_scan', 'web').
--
-- `aliases text[]` lets a library food answer to short spoken names ("eggs",
-- "my eggs") so the assistant and unified search can resolve "log 3 eggs" to the
-- user's saved branded egg carton. Resolution order is: exact alias match →
-- library name match → USDA/database. Stored as a Postgres array (not a side
-- table) because it is small, always fetched with its food row, and covered by
-- the foods table's existing owner RLS — no extra policy needed. See HANDOFF §6.
--
-- `source_ref` records where a food's numbers came from when that provenance is
-- a URL — specifically web-search results (`source = 'web'`) store the
-- manufacturer/retailer page the nutrition was read from, shown at confirmation
-- and as a subtle provenance marker on the food row.
--
-- The two new `source` values:
--   'label_scan' — a Nutrition Facts panel photographed and read by Claude.
--   'web'        — nutrition pulled from a web search when USDA had no match.
--
-- Idempotent: re-running is a no-op if already applied.
-- ---------------------------------------------------------------------------

alter table foods
  add column if not exists aliases text[] not null default '{}';

alter table foods
  add column if not exists source_ref text;

-- Extend the foods.source CHECK to allow 'label_scan' and 'web'. A CHECK can't
-- be altered in place, so drop the old constraint (from 0018) and re-add it with
-- the wider set.
alter table foods drop constraint if exists foods_source_check;

do $$ begin
  alter table foods
    add constraint foods_source_check
    check (source in ('manual', 'usda', 'supplement_scan', 'receipt', 'estimate', 'label_scan', 'web'));
exception
  when duplicate_object then null;
end $$;

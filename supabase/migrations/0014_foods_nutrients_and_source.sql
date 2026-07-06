-- ---------------------------------------------------------------------------
-- 0014: capture full nutrient profiles + record where a food came from.
--
-- `nutrients` stashes the complete micronutrient list (not just the four macro
-- columns) so a future "micronutrient targets" feature has real data to work
-- with. Shape is a normalized array:
--   USDA imports:      [{ name, amount, unit, per: "100g" }]
--   supplement scans:  [{ name, amount, unit, per: "serving",
--                         amount_normalized_mcg_or_mg, percent_dv }]
-- Nullable: the macro columns are unchanged and remain the source of truth for
-- calories/protein/carbs/fat; `nutrients` is purely additive data capture.
--
-- `source` marks how a food entered the library so scanned/imported items can be
-- told apart from hand-entered ones.
-- ---------------------------------------------------------------------------

alter table foods add column if not exists nutrients jsonb;

alter table foods add column if not exists source text not null default 'manual';

-- Constrain to the known origins. Wrapped so re-running the migration is safe.
do $$ begin
  alter table foods
    add constraint foods_source_check
    check (source in ('manual', 'usda', 'supplement_scan', 'receipt'));
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 0025: remember when the user declined the auto-enrichment proposal.
--
-- Saving a scanned/looked-up food (source 'label_scan' or 'web') now offers to
-- borrow the rest of the micronutrient profile from a generic USDA equivalent
-- (the existing foodEnrich flow, made a default prompt). If the user skips that
-- offer we must not nag them again the next time they open/edit the food, so we
-- store their choice here. Nullable/false by default; set true only on skip.
--
-- Idempotent: re-running is a no-op if already applied.
-- ---------------------------------------------------------------------------

alter table foods
  add column if not exists enrich_skipped boolean not null default false;

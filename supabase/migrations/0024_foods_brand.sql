-- ---------------------------------------------------------------------------
-- 0024: give branded foods their own `brand` column.
--
-- Until now a scanned/looked-up food folded the maker into its name, e.g.
-- "Organic Pasture-Raised Eggs (Contented Hen)". Storing the brand separately
-- lets the app show it on its own line (product on top, brand beneath) in the
-- food library and on logged meal rows, and keeps the food's `name` clean for
-- search and the assistant. Nullable — hand-entered and generic foods leave it
-- empty. Existing foods keep their current names untouched (backward compatible).
--
-- Idempotent: re-running is a no-op if already applied.
-- ---------------------------------------------------------------------------

alter table foods
  add column if not exists brand text;

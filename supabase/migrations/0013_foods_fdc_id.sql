-- ---------------------------------------------------------------------------
-- 0013: remember which USDA FoodData Central entry a food came from.
--
-- When a user imports a food via the USDA search, we stash its FDC id here so a
-- later search for the same item can recognize "you already have this" instead
-- of creating a duplicate foods row. Nullable: manually-entered foods (home
-- cooking, backyard eggs) never get an fdc_id, and that's fine.
-- ---------------------------------------------------------------------------

alter table foods add column if not exists fdc_id text;

-- One row per (user, USDA food) so dedup lookups are fast. Partial index skips
-- the many manual foods that have no fdc_id.
create index if not exists foods_user_fdc_id_idx
  on foods (user_id, fdc_id)
  where fdc_id is not null;

-- ---------------------------------------------------------------------------
-- 0020: per-user micronutrient targets + sex cohort.
--
-- Adds two columns to nutrition_targets (still one row per user):
--   • micro_targets jsonb — user overrides for micronutrient goals, keyed by the
--     canonical nutrient id from src/lib/nutrients.js, each value
--     { "target": number|null, "upper_limit": number|null }. Any id absent from
--     this object falls back to the built-in RDA/UL default for the user's sex.
--     Defaults to '{}' so a user with no overrides just uses the defaults.
--   • sex text — 'male' | 'female' | 'neutral', the cohort used to pick default
--     RDAs/ULs. Optional; defaults to 'neutral' (the male/female average) so the
--     feature works before the user answers the Settings question.
--
-- Idempotent: re-running is a no-op if the columns already exist.
-- ---------------------------------------------------------------------------

alter table nutrition_targets add column if not exists micro_targets jsonb not null default '{}'::jsonb;
alter table nutrition_targets add column if not exists sex text not null default 'neutral';

-- Guard the small set of allowed cohort values. Added separately so re-running
-- the migration doesn't error if the constraint is already present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'nutrition_targets_sex_check'
  ) then
    alter table nutrition_targets
      add constraint nutrition_targets_sex_check check (sex in ('male', 'female', 'neutral'));
  end if;
end $$;

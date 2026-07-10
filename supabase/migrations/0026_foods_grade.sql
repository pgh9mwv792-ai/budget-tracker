-- ---------------------------------------------------------------------------
-- 0026: food "grade" attribute (quality tier of a base food).
--
-- A grade captures the quality/production claim of a food — pasture-raised eggs,
-- grass-fed beef, wild vs. farmed salmon, whole vs. skim milk, organic, etc. It
-- is a nullable free-text id from the fixed enum in src/lib/gradeProfiles.js
-- (that file is the gate: a grade only exists if it has a distinct USDA entry or
-- a cited composition study). Nutrition changes, when any, are stored in the
-- food's `nutrients` jsonb as rows tagged `profile: <grade_id>` (same mechanism
-- as `enriched_from`), NOT here — this column only records which grade is set so
-- the UI can show the chip and re-apply/strip the profile.
--
-- Nullable: hand-entered and generic foods leave it empty. Backward compatible;
-- existing foods are untouched.
--
-- Idempotent: re-running is a no-op if already applied.
-- ---------------------------------------------------------------------------

alter table foods
  add column if not exists grade text;

-- ---------------------------------------------------------------------------
-- 0022: allow 'supplement' as a meal bucket.
--
-- The Meals tab now shows a "Supplements" section alongside Breakfast, Lunch,
-- Dinner, and Snacks (so pills/vitamins get their own dropdown instead of
-- landing in Uncategorized). food_logs.meal has a CHECK that only permitted the
-- original four values, so widen it to include 'supplement'.
--
-- Existing rows are unaffected; NULL (uncategorized) still passes the check.
-- Idempotent: drop the old constraint if present, then add the widened one.
-- The inline check from migration 0003 is auto-named food_logs_meal_check.
-- ---------------------------------------------------------------------------

alter table food_logs drop constraint if exists food_logs_meal_check;

alter table food_logs
  add constraint food_logs_meal_check
  check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'supplement'));

-- Meal tracker restructure: a food log can now be "uncategorized" (no meal).
-- Make food_logs.meal nullable and drop its default so a log inserted without a
-- meal (the AI assistant when it omits one, or the Uncategorized bucket's +)
-- stores NULL = uncategorized. Existing rows keep whatever meal they already
-- have. The existing CHECK (meal in (...)) still passes for NULL, so it stays.
-- Idempotent: re-running these is a no-op if already applied.

alter table food_logs alter column meal drop not null;
alter table food_logs alter column meal drop default;

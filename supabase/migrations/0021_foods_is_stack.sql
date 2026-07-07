-- ---------------------------------------------------------------------------
-- 0021: mark a food as part of the user's daily supplement "stack".
--
-- A stack is the set of pills/supplements someone takes every day. Flagging the
-- foods that belong to it powers a one-tap "Log my stack" button (and an
-- assistant shortcut) that logs each of them at one serving in a single step,
-- instead of adding them one by one every morning.
--
-- Nullable-safe default: every existing and future food starts false; the user
-- opts a food in from its library row or when saving a scanned supplement.
-- Idempotent: re-running is a no-op if the column already exists.
-- ---------------------------------------------------------------------------

alter table foods add column if not exists is_stack boolean not null default false;

-- Fast "give me this user's stack" lookup; partial so it only indexes the few
-- foods actually in a stack, not the whole library.
create index if not exists foods_user_is_stack_idx
  on foods (user_id)
  where is_stack;

-- Budget tracker: AI usage metering / daily rate limit
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER 0004.
--
-- Protects your Anthropic API bill by capping how many assistant requests each
-- user can make per day. The `chat` Edge Function calls increment_ai_usage()
-- (with the service role) before every Claude call; if the user is over the
-- limit it refuses. One row per user per day.

create table if not exists ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table ai_usage enable row level security;

-- Users may read their own usage (e.g. to show "N requests left today").
-- Writes happen only through the security-definer function / service role.
create policy "ai_usage is readable by owner"
  on ai_usage for select
  using (auth.uid() = user_id);

-- Atomically bump today's counter for a user, but only if they are under the
-- given limit. Returns whether the request is allowed and the resulting count.
-- SECURITY DEFINER so it can write regardless of the caller's RLS; it only ever
-- touches the row for the user id passed in by the (already authenticated)
-- Edge Function.
create or replace function increment_ai_usage(p_user_id uuid, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  insert into ai_usage (user_id, day, count)
  values (p_user_id, current_date, 0)
  on conflict (user_id, day) do nothing;

  select count into current_count
  from ai_usage
  where user_id = p_user_id and day = current_date
  for update;

  if current_count >= p_limit then
    return query select false, current_count;
  else
    update ai_usage set count = count + 1
    where user_id = p_user_id and day = current_date;
    return query select true, current_count + 1;
  end if;
end;
$$;

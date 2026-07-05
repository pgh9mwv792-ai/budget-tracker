-- Budget tracker: assistant long-term memory
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER 0003.
--
-- Stores small, durable facts the AI assistant has been told to remember about
-- the user (preferences, goals, context). Like every other table here it's
-- protected by row-level security, so a memory row is only ever readable by the
-- user who created it — nothing is shared with anyone else or any outside
-- service. Content is intentionally free-form text and should never hold
-- secrets (passwords, full card/account numbers, etc.).

create table if not exists assistant_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table assistant_memories enable row level security;

create policy "assistant_memories are owned by user"
  on assistant_memories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists assistant_memories_user_idx on assistant_memories (user_id, created_at);

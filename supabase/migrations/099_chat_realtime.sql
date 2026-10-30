-- 099_chat_realtime.sql
--
-- Puts chat_messages on the Realtime publication, which is what makes a
-- message appear on everyone's phone without the app polling for it.
--
-- Realtime applies the same row level security as any other read, so the
-- policies in 097 do the work here too: a player only receives messages for
-- leagues they are in, and a blocked player's messages are never delivered
-- rather than delivered and hidden.
--
-- Written as a guarded block because adding a table that is already on the
-- publication is an error, and this migration should be safe to run twice.
--
-- RUN ON DEV FIRST, then production. Depends on 096 and 097.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Check. Should return one row.
-- ---------------------------------------------------------------------------
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename = 'chat_messages';

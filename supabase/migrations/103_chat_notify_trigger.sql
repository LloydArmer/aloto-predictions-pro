-- 103_chat_notify_trigger.sql
--
-- Calls notify-chat when a message is posted, without using the dashboard's
-- Database Webhooks screen.
--
-- A Database Webhook is only a trigger that makes an HTTP request, so this is
-- the same thing written down. Doing it here has two advantages beyond not
-- having to find the screen: it is in version control with everything else,
-- and Dev and Production end up identical rather than separately clicked.
--
-- THE KEY IS NOT IN THIS FILE, and must not be. It is read from Vault at the
-- moment the trigger fires, so the repository never contains it. The two
-- secrets are created once per project, in the SQL editor — see below.
--
-- RUN ON DEV FIRST, then production. Depends on 096.

-- pg_net makes the request without blocking the insert: it queues the call and
-- returns immediately, so a slow edge function cannot make sending a message
-- feel slow.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- STEP ONE — the two secrets. Run this ONCE per project, with your own values.
-- ---------------------------------------------------------------------------
--
-- Run it in the SQL editor rather than putting it in this file, so the key is
-- never written into the repository. Both are per project: the Dev key belongs
-- to Dev and will not work against Production.
--
--   select vault.create_secret(
--     'PASTE YOUR SERVICE ROLE KEY HERE',
--     'service_role_key',
--     'Used by the chat notification trigger');
--
--   select vault.create_secret(
--     'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-chat',
--     'notify_chat_url',
--     'Where the chat notification trigger posts');
--
-- To change one later, delete and recreate it:
--   delete from vault.secrets where name = 'service_role_key';

-- ---------------------------------------------------------------------------
-- STEP TWO — the trigger. This file does the rest.
-- ---------------------------------------------------------------------------
create or replace function chat_notify_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_chat_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  -- Missing secrets must not stop anyone talking. Chat works perfectly well
  -- without notifications; a message that cannot be posted because a secret is
  -- absent would be a far worse failure than a mention nobody is told about.
  if v_url is null or v_key is null then
    raise warning 'chat_notify_webhook: vault secrets not set, no notification sent';
    return new;
  end if;

  -- The same shape a Database Webhook sends, so the function does not care
  -- which route was used and either can be swapped in later.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object(
                 'type',   'INSERT',
                 'table',  'chat_messages',
                 'schema', 'public',
                 'record', to_jsonb(new))
  );

  return new;
end;
$$;

-- AFTER insert, not BEFORE: the message is already saved by the time this
-- runs, so nothing about notifying can cost somebody their message.
--
-- Inserts only. Firing on update would notify again every time a typo was
-- fixed, and a removal would re-announce the message it just removed.
drop trigger if exists trg_chat_notify on public.chat_messages;
create trigger trg_chat_notify
  after insert on public.chat_messages
  for each row execute function chat_notify_webhook();

-- ---------------------------------------------------------------------------
-- Check. Both should be true before you expect a notification.
-- ---------------------------------------------------------------------------
select
  (select count(*) from vault.decrypted_secrets
    where name in ('service_role_key','notify_chat_url')) = 2  as both_secrets_set,
  exists (select 1 from pg_trigger where tgname = 'trg_chat_notify') as trigger_installed;

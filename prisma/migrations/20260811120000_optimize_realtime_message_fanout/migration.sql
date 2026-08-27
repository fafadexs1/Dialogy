-- Message status/read/transcription updates are useful to clients watching the
-- conversation room, but they do not change the workspace inbox list. Sending
-- the complete row to the workspace topic makes every workspace member receive
-- the same update and forces the browser to discard it after delivery.
--
-- Keep the room topic authoritative for all operations. The workspace topic is
-- retained for INSERT/DELETE so the inbox can detect new or removed messages;
-- chat INSERTs also update public.chats and are broadcast through the chats
-- topic by the existing chat triggers.
CREATE OR REPLACE FUNCTION public.broadcast_message_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  chat_topic text := 'room:' || COALESCE(NEW.chat_id, OLD.chat_id)::text || ':messages';
  workspace_topic text := 'workspace:' || COALESCE(NEW.workspace_id, OLD.workspace_id)::text || ':messages';
BEGIN
  -- Some delivery/status paths issue a row UPDATE without changing any
  -- column. Do not turn that no-op into a Realtime event.
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NEW;
  END IF;

  PERFORM realtime.broadcast_changes(
    chat_topic,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );

  IF TG_OP <> 'UPDATE' THEN
    PERFORM realtime.broadcast_changes(
      workspace_topic,
      TG_OP,
      TG_OP,
      TG_TABLE_NAME,
      TG_TABLE_SCHEMA,
      NEW,
      OLD
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Phase 1 intentionally leaves the existing chat metadata function and
-- tr_chats_last_activity trigger untouched. They are still in production and
-- will be consolidated in a separate, observed rollout after this fan-out
-- reduction is verified.

-- Phase 2: consolidate the two chat updates caused by one message INSERT.
-- The old update_chat_last_activity() function is intentionally retained for
-- rollback; only its redundant messages trigger is removed.
CREATE OR REPLACE FUNCTION public.update_chat_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.chats
  SET
    last_activity_at = NEW.created_at,
    updated_at = NEW.created_at,
    last_message_preview = LEFT(NEW.content, 100),
    unread_count = CASE
      WHEN NEW.from_me = FALSE THEN unread_count + 1
      ELSE unread_count
    END
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$function$;

-- update_chat_on_message now performs the complete metadata update above, so
-- this second AFTER INSERT trigger would otherwise broadcast the same chat
-- twice. The function itself remains available for an emergency rollback.
DROP TRIGGER IF EXISTS tr_chats_last_activity ON public.messages;

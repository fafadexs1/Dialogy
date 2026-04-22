-- Codify the message broadcast infrastructure used by the web inbox.
-- We keep a room-scoped topic for the active chat and add a workspace-scoped
-- topic for inbox list updates.

ALTER TABLE "realtime"."messages" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA "realtime" TO authenticated;

CREATE OR REPLACE FUNCTION public.is_workspace_member(target_workspace uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_workspace_roles uwr
    WHERE uwr.workspace_id = target_workspace
      AND uwr.user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.topic_chat_id(topic text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(SPLIT_PART(topic, ':', 2), '')::uuid
  WHERE SPLIT_PART(topic, ':', 1) = 'room'
$function$;

CREATE OR REPLACE FUNCTION public.topic_workspace_id(topic text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(SPLIT_PART(topic, ':', 2), '')::uuid
  WHERE SPLIT_PART(topic, ':', 1) = 'workspace'
$function$;

DROP POLICY IF EXISTS "room_members_can_receive" ON "realtime"."messages";
CREATE POLICY "room_members_can_receive"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'room:%:messages'
  AND EXISTS (
    SELECT 1
    FROM public.chats c
    WHERE c.id = topic_chat_id((SELECT realtime.topic()))
      AND is_workspace_member(c.workspace_id)
  )
);

DROP POLICY IF EXISTS "room_members_can_send" ON "realtime"."messages";
CREATE POLICY "room_members_can_send"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'room:%:messages'
  AND EXISTS (
    SELECT 1
    FROM public.chats c
    WHERE c.id = topic_chat_id((SELECT realtime.topic()))
      AND is_workspace_member(c.workspace_id)
  )
);

DROP POLICY IF EXISTS "workspace_chats_receive" ON "realtime"."messages";
CREATE POLICY "workspace_chats_receive"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:chats'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "workspace_chats_send" ON "realtime"."messages";
CREATE POLICY "workspace_chats_send"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:chats'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "workspace_contacts_receive" ON "realtime"."messages";
CREATE POLICY "workspace_contacts_receive"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:contacts'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "workspace_contacts_send" ON "realtime"."messages";
CREATE POLICY "workspace_contacts_send"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:contacts'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "workspace_messages_receive" ON "realtime"."messages";
CREATE POLICY "workspace_messages_receive"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:messages'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "workspace_messages_send" ON "realtime"."messages";
CREATE POLICY "workspace_messages_send"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:messages'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

CREATE OR REPLACE FUNCTION public.broadcast_message_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  chat_topic text := 'room:' || COALESCE(NEW.chat_id, OLD.chat_id)::text || ':messages';
  workspace_topic text := 'workspace:' || COALESCE(NEW.workspace_id, OLD.workspace_id)::text || ':messages';
BEGIN
  PERFORM realtime.broadcast_changes(
    chat_topic,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );

  PERFORM realtime.broadcast_changes(
    workspace_topic,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS "messages_broadcast_trigger" ON "public"."messages";
CREATE TRIGGER "messages_broadcast_trigger"
AFTER INSERT OR UPDATE OR DELETE
ON "public"."messages"
FOR EACH ROW
EXECUTE FUNCTION public.broadcast_message_changes();

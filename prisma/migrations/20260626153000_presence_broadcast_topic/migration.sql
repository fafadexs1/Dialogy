DROP POLICY IF EXISTS "workspace_presence_receive" ON "realtime"."messages";
CREATE POLICY "workspace_presence_receive"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:presence'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "workspace_presence_send" ON "realtime"."messages";
CREATE POLICY "workspace_presence_send"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'workspace:%:presence'
  AND is_workspace_member(topic_workspace_id((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "global_alert_send" ON "realtime"."messages";
CREATE POLICY "global_alert_send"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) = 'system:global-alert'
);

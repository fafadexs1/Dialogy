DROP POLICY IF EXISTS "global_alert_receive" ON "realtime"."messages";
CREATE POLICY "global_alert_receive"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) = 'system:global-alert'
);

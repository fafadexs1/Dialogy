-- Each person receives only their own ephemeral reactions. Sending is performed
-- by the authenticated server action after checking workspace membership.
DROP POLICY IF EXISTS "team_reactions_receive" ON realtime.messages;
CREATE POLICY "team_reactions_receive" ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) = 'private:team-reaction:' || (SELECT auth.uid())::text
);

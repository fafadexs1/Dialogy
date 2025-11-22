-- Enable RLS on messages table
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;

-- Set Replica Identity to FULL to ensure all columns are available in the replication log
-- This fixes the "UnableToBroadcastChanges: :payload_missing" error
ALTER TABLE "messages" REPLICA IDENTITY FULL;

-- Drop policy if it exists to avoid errors on retry
DROP POLICY IF EXISTS "Users can view messages for their chats" ON "messages";

-- Create policy to allow users to view messages from chats in their workspaces
CREATE POLICY "Users can view messages for their chats" ON "messages"
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "chats" c
    JOIN "user_workspace_roles" uwr ON uwr.workspace_id = c.workspace_id
    WHERE c.id = "messages".chat_id
    AND uwr.user_id = auth.uid()
  )
);

-- Add messages table to the supabase_realtime publication
-- We use DO block to avoid error if it's already added or if publication doesn't exist (though it should in Supabase)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "messages";
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- If publication doesn't exist, we can try to create it or just ignore (it might be a local dev env without realtime setup)
    -- But for Supabase it should exist.
    NULL;
END $$;

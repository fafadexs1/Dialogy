-- Grant permissions to authenticated users
GRANT ALL ON TABLE "support_tickets" TO authenticated;
GRANT ALL ON TABLE "support_tickets" TO service_role;
GRANT ALL ON TABLE "support_messages" TO authenticated;
GRANT ALL ON TABLE "support_messages" TO service_role;

-- Enable RLS
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean slate
DROP POLICY IF EXISTS "Users can create tickets" ON "support_tickets";
DROP POLICY IF EXISTS "Users can view own tickets" ON "support_tickets";
DROP POLICY IF EXISTS "Superadmins can view all tickets" ON "support_tickets";
DROP POLICY IF EXISTS "Users can reply to tickets" ON "support_messages";
DROP POLICY IF EXISTS "Users can view messages of their tickets" ON "support_messages";

-- Re-create Policies

-- 1. Tickets: Insert
CREATE POLICY "Users can create tickets" 
ON "support_tickets" 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- 2. Tickets: Select (Own + Admin)
CREATE POLICY "Users can view own tickets" 
ON "support_tickets" 
FOR SELECT 
TO authenticated 
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
);

-- 3. Tickets: Update (Optional, maybe for closing?)
CREATE POLICY "Users can update own tickets" 
ON "support_tickets" 
FOR UPDATE
TO authenticated 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 4. Messages: Insert (Owner + Admin)
CREATE POLICY "Users can reply to tickets" 
ON "support_messages" 
FOR INSERT 
TO authenticated 
WITH CHECK (
  auth.uid() = user_id
  -- We trust the server action to validate relationship, 
  -- but strictly, RLS should verify ticket ownership too if we want to be paranoid.
  -- For now, letting the user insert if they are the author of the message is base level.
  -- Adding logic to check ticket existence:
  AND (
    EXISTS (SELECT 1 FROM support_tickets WHERE id = ticket_id AND user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  )
);

-- 5. Messages: Select (Owner + Admin)
CREATE POLICY "Users can view messages of their tickets" 
ON "support_messages" 
FOR SELECT 
TO authenticated 
USING (
    EXISTS (SELECT 1 FROM support_tickets WHERE id = ticket_id AND (user_id = auth.uid()))
    OR
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
);

-- Enable RLS on tables
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;

-- POLICY: Users can insert their own tickets
CREATE POLICY "Users can create tickets" 
ON "support_tickets" 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- POLICY: Users can view their own tickets
CREATE POLICY "Users can view own tickets" 
ON "support_tickets" 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- POLICY: Superadmins can view all tickets
CREATE POLICY "Superadmins can view all tickets" 
ON "support_tickets" 
FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
    AND is_superadmin = true
  )
);

-- POLICY: Users can insert messages if they own the ticket OR are superadmin
CREATE POLICY "Users can reply to tickets" 
ON "support_messages" 
FOR INSERT 
TO authenticated 
WITH CHECK (
  -- User matches the message sender
  auth.uid() = user_id 
  AND (
    -- User owns the ticket
    EXISTS (
        SELECT 1 FROM "support_tickets"
        WHERE id = ticket_id
        AND user_id = auth.uid()
    )
    OR 
    -- User is superadmin
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() 
        AND is_superadmin = true
    )
  )
);

-- POLICY: Users can view messages of tickets they own
CREATE POLICY "Users can view messages of their tickets" 
ON "support_messages" 
FOR SELECT 
TO authenticated 
USING (
    -- User owns the ticket associated with the message
    EXISTS (
        SELECT 1 FROM "support_tickets"
        WHERE id = ticket_id
        AND user_id = auth.uid()
    )
    OR
    -- User sent the message (redundant but safe)
    user_id = auth.uid()
    OR
    -- Superadmin
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() 
        AND is_superadmin = true
    )
);

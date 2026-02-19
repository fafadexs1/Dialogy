-- Allow superadmins to update ticket status and delete tickets.
-- This fixes operations returning zero affected rows under RLS.

DROP POLICY IF EXISTS "Users can update own tickets or superadmin" ON "support_tickets";
CREATE POLICY "Users can update own tickets or superadmin"
ON "support_tickets"
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  OR
  public.check_is_superadmin()
)
WITH CHECK (
  auth.uid() = user_id
  OR
  public.check_is_superadmin()
);

DROP POLICY IF EXISTS "Superadmins can delete all tickets" ON "support_tickets";
CREATE POLICY "Superadmins can delete all tickets"
ON "support_tickets"
FOR DELETE
TO authenticated
USING (
  public.check_is_superadmin()
);

DROP POLICY IF EXISTS "Superadmins can delete all ticket messages" ON "support_messages";
CREATE POLICY "Superadmins can delete all ticket messages"
ON "support_messages"
FOR DELETE
TO authenticated
USING (
  public.check_is_superadmin()
);

-- Create a secure function to check admin status (bypasses RLS)
CREATE OR REPLACE FUNCTION public.check_is_superadmin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- This makes it run with owner permissions (bypassing RLS)
SET search_path = public -- Secure search path
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND is_superadmin = true
  );
END;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.check_is_superadmin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_superadmin() TO service_role;

-- Fix USERS table policies
DROP POLICY IF EXISTS "Superadmins can view all profiles" ON "users";
-- Keep "Users can view own profile" (it's safe)

-- Re-add Superadmin view all for users, but using the function to avoid recursion
CREATE POLICY "Superadmins can view all profiles" 
ON "users" 
FOR SELECT 
TO authenticated 
USING (
    public.check_is_superadmin()
);

-- Fix SUPPORT_TICKETS policies
DROP POLICY IF EXISTS "Users can view own tickets" ON "support_tickets";
CREATE POLICY "Users can view own tickets" 
ON "support_tickets" 
FOR SELECT 
TO authenticated 
USING (
  auth.uid() = user_id 
  OR 
  public.check_is_superadmin()
);

-- Fix SUPPORT_MESSAGES policies
DROP POLICY IF EXISTS "Users can reply to tickets" ON "support_messages";
CREATE POLICY "Users can reply to tickets" 
ON "support_messages" 
FOR INSERT 
TO authenticated 
WITH CHECK (
  auth.uid() = user_id
  AND (
    EXISTS (SELECT 1 FROM support_tickets WHERE id = ticket_id AND user_id = auth.uid())
    OR
    public.check_is_superadmin()
  )
);

DROP POLICY IF EXISTS "Users can view messages of their tickets" ON "support_messages";
CREATE POLICY "Users can view messages of their tickets" 
ON "support_messages" 
FOR SELECT 
TO authenticated 
USING (
    EXISTS (SELECT 1 FROM support_tickets WHERE id = ticket_id AND user_id = auth.uid())
    OR
    public.check_is_superadmin()
);

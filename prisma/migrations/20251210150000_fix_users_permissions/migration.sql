-- Grant permissions to authenticated users for the users table
GRANT SELECT ON TABLE "users" TO authenticated;
GRANT SELECT ON TABLE "users" TO service_role;

-- Enable RLS just in case
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view own profile" ON "users";
DROP POLICY IF EXISTS "Superadmins can view all profiles" ON "users";

-- Policy: Users can see their own profile
CREATE POLICY "Users can view own profile" 
ON "users" 
FOR SELECT 
TO authenticated 
USING (auth.uid() = id);

-- Policy: Superadmins can see all profiles (needed for admin UI later)
CREATE POLICY "Superadmins can view all profiles" 
ON "users" 
FOR SELECT 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() 
        AND is_superadmin = true
    )
);

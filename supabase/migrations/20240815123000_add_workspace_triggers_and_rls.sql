-- Drop triggers if they exist to ensure idempotency
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS on_workspace_created_add_user ON public.workspaces;

-- Drop functions if they exist
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();


-- Function to set workspace owner from the authenticated user
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set owner_id to the ID of the authenticated user
  NEW.owner_id := auth.uid();
  RETURN NEW;
END;
$$;

-- Trigger to execute the function before insert on workspaces
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();


-- Function to add the creator as a member of the new workspace
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert the creator (auth.uid()) into the user_workspaces association table
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (NEW.owner_id, NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger to execute the function after insert on workspaces
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- Remove potentially conflicting or redundant policies
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;

-- Policy to allow authenticated users to create workspaces
-- The WITH CHECK true is simple because the owner_id is set by the trigger
CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy to allow owners to update their workspaces
CREATE POLICY "Owners can update their own workspaces" ON public.workspaces
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Policy to allow users to view workspaces they are a member of
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces
  FOR SELECT
  TO authenticated
  USING (id IN (
    SELECT workspace_id FROM user_workspaces WHERE user_id = auth.uid()
  ));

-- RLS for user_workspaces table
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- This policy allows users to be added to workspaces, crucial for the trigger
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
CREATE POLICY "Users can be added to workspaces"
    ON public.user_workspaces
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
    
-- New policy for users table to allow reads by authenticated users
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;
CREATE POLICY "Allow authenticated users to read users table" ON public.users
  FOR SELECT
  TO authenticated
  USING (true);

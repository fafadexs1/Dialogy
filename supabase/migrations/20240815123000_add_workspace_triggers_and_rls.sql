-- Drop Triggers before Functions to avoid dependency errors
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces; -- Old trigger name
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS on_workspace_created_add_user ON public.workspaces; -- Old trigger name

-- Drop Functions
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();

-- Drop Policies to ensure they can be re-created cleanly
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces; -- Old/redundant policy
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can delete their own or be deleted by owner" ON public.user_workspaces;


--
-- RLS POLICIES
--

-- Users Table
-- Allow authenticated users to read the users table (needed for resolving user details in joins).
CREATE POLICY "Allow authenticated users to read users table"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- Workspaces Table
-- Allow users to see workspaces they are a member of.
CREATE POLICY "Users can view workspaces they are a member of"
ON public.workspaces
FOR SELECT
TO authenticated
USING (id IN (
  SELECT user_workspaces.workspace_id
  FROM public.user_workspaces
  WHERE user_workspaces.user_id = auth.uid()
));

-- Allow any authenticated user to create a workspace (the trigger will handle ownership).
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow workspace owners to update their workspaces.
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Allow workspace owners to delete their workspaces.
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces
FOR DELETE
TO authenticated
USING (owner_id = auth.uid());

-- User Workspaces Table
-- Allow users to see their own memberships.
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Allow users/owners to manage memberships (insert). The trigger `add_creator_to_workspace` handles the initial insert.
CREATE POLICY "Users can insert their own workspace memberships"
ON public.user_workspaces
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR (
  SELECT ws.owner_id FROM public.workspaces ws WHERE ws.id = workspace_id
) = auth.uid());

-- Allow users to leave a workspace, or owners to remove users.
CREATE POLICY "Users can delete their own or be deleted by owner"
ON public.user_workspaces
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR (
  SELECT ws.owner_id FROM public.workspaces ws WHERE ws.id = workspace_id
) = auth.uid());


--
-- TRIGGERS AND FUNCTIONS
--

-- Function to set the workspace owner on creation.
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set the owner_id to the ID of the authenticated user.
  new.owner_id := auth.uid();
  RETURN new;
END;
$$;

-- Function to add the creator as a member of the workspace.
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert the creator into the user_workspaces association table.
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (new.owner_id, new.id);
  RETURN new;
END;
$$;

-- Trigger to automatically set the owner when a new workspace is created.
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();

-- Trigger to automatically add the creator to the workspace members.
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();

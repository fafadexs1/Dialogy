-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert themselves into workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can delete their own or be deleted by owner" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;

-- Drop dependent triggers before functions
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
-- Also dropping the other trigger name from the error log to be safe
DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces;


-- Drop functions after triggers are removed
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();


-- 1. Function to set workspace owner
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set owner_id to the ID of the authenticated user
  new.owner_id := auth.uid();
  RETURN new;
END;
$$;

-- 2. Function to add the creator to the workspace members
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert the creator into the user_workspaces table
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (new.owner_id, new.id);
  RETURN new;
END;
$$;


-- Create Triggers
-- Trigger to set the owner before inserting a new workspace
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();

-- Trigger to add the creator to members after inserting a new workspace
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- RLS Policies for `workspaces`
-- Users can see workspaces they are a member of
CREATE POLICY "Users can view workspaces they are a member of"
ON public.workspaces FOR SELECT
TO authenticated
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

-- Any authenticated user can create a workspace (the trigger will set ownership)
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);

-- Workspace owners can update their own workspaces
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Workspace owners can delete their own workspaces
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
TO authenticated
USING (owner_id = auth.uid());


-- RLS Policies for `user_workspaces` (associative table)
-- Users can see their own memberships
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can insert themselves into a workspace (or be added by the owner)
-- The trigger handles the creator's insertion automatically. This policy is for future "invite" features.
CREATE POLICY "Users can insert themselves into workspaces"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid() OR
    (SELECT owner_id FROM public.workspaces WHERE id = workspace_id) = auth.uid()
);

-- Users can leave a workspace, or be removed by the owner
CREATE POLICY "Users can delete their own or be deleted by owner"
ON public.user_workspaces FOR DELETE
TO authenticated
USING (
    user_id = auth.uid() OR
    (SELECT owner_id FROM public.workspaces WHERE id = workspace_id) = auth.uid()
);

-- RLS Policies for `users` table
-- Users can update their own profile information, including their last active workspace
CREATE POLICY "Users can update their own data"
ON public.users FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

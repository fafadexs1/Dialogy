-- Drop triggers before functions to avoid dependency errors
DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS on_workspace_created_add_user ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;

-- Drop functions
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();

-- Drop policies to ensure they can be recreated
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be deleted by owner" ON public.user_workspaces;


-- Function to set workspace owner on creation
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  -- The RLS policy ensures only authenticated users can get here.
  -- We can safely set the owner_id to the user's UID.
  new.owner_id := auth.uid();
  return new;
end;
$$;

-- Trigger to execute the function before a new workspace is inserted
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();

-- Function to add the creator to the workspace members
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  -- Insert the creator (owner) into the user_workspaces table
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  return new;
end;
$$;

-- Trigger to execute the function after a new workspace is created
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- RLS Policies

-- Allow any authenticated user to read from the users table.
-- This is necessary for Supabase to resolve foreign key relationships in queries.
CREATE POLICY "Allow authenticated users to read users table"
ON public.users FOR SELECT
TO authenticated
USING (true);

-- Allow users to see only the workspaces they are members of.
CREATE POLICY "Users can view workspaces they are a member of"
ON public.workspaces FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT workspace_id
    FROM public.user_workspaces
    WHERE user_id = auth.uid()
  )
);

-- Allow authenticated users to create workspaces. The owner_id is set by a trigger.
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow workspace owners to update their workspaces.
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Allow workspace owners to delete their workspaces.
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
TO authenticated
USING (owner_id = auth.uid());


-- Policies for user_workspaces junction table

-- Users can see their own memberships.
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- This policy is now handled by the trigger, but we can keep a restrictive one
-- for direct inserts if needed (e.g., inviting other users, which is not implemented yet).
-- For now, the trigger handles the creator's membership.
CREATE POLICY "Users can insert their own workspace memberships"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Allow users to be removed from a workspace by the owner, or to remove themselves.
CREATE POLICY "Users can be deleted by owner"
ON public.user_workspaces FOR DELETE
TO authenticated
USING (
    -- user can delete their own membership
    (user_id = auth.uid()) OR
    -- owner of the workspace can delete any membership
    (
        (
            SELECT w.owner_id
            FROM public.workspaces w
            WHERE w.id = user_workspaces.workspace_id
        ) = auth.uid()
    )
);

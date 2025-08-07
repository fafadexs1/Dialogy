-- Drop old triggers with potentially conflicting names first to avoid dependency errors.
-- These DROP statements specifically target the triggers mentioned in the error logs.
DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;

DROP TRIGGER IF EXISTS on_workspace_created_add_user ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;

-- Now, drop the functions they depend on.
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();


-- 1. Function to set the workspace owner automatically
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
begin
  -- Set the owner_id to the ID of the authenticated user creating the workspace.
  -- RLS policy ensures only authenticated users can get this far.
  new.owner_id := auth.uid();
  return new;
end;
$$;

-- 2. Function to add the creator to the workspace members automatically
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
begin
  -- Insert the creator (who is the owner) into the user_workspaces junction table.
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  return new;
end;
$$;


-- 3. Trigger to execute the set_workspace_owner function before a new workspace is inserted
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();


-- 4. Trigger to execute the add_creator_to_workspace function after a new workspace is inserted
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- 5. RLS Policies for workspaces table
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
CREATE POLICY "Authenticated users can create workspaces"
    ON public.workspaces
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
CREATE POLICY "Owners can update their own workspaces"
    ON public.workspaces
    FOR UPDATE
    TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
CREATE POLICY "Users can view workspaces they are a member of"
    ON public.workspaces
    FOR SELECT
    TO authenticated
    USING (id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
CREATE POLICY "Owners can delete their own workspaces"
    ON public.workspaces
    FOR DELETE
    TO authenticated
    USING (owner_id = auth.uid());


-- 6. RLS Policies for user_workspaces table
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
CREATE POLICY "Users can view their own workspace memberships"
    ON public.user_workspaces
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Note: The trigger now handles the initial insert for the creator.
-- This policy allows workspace owners to add other users.
DROP POLICY IF EXISTS "Workspace owners can manage members" ON public.user_workspaces;
CREATE POLICY "Workspace owners can manage members"
    ON public.user_workspaces
    FOR ALL
    TO authenticated
    USING (
        -- The user is the owner of the workspace
        (SELECT owner_id FROM public.workspaces WHERE id = workspace_id) = auth.uid()
        -- Or the user is modifying their own membership
        OR user_id = auth.uid()
    )
    WITH CHECK (
        -- The user is the owner of the workspace
        (SELECT owner_id FROM public.workspaces WHERE id = workspace_id) = auth.uid()
         -- Or the user is adding themself
        OR user_id = auth.uid()
    );

-- Clean up old, redundant policies on user_workspaces
DROP POLICY IF EXISTS "Users can add themselves to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert themselves into workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow users to join workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow users to see their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can delete their own or be deleted by owner" ON public.user_workspaces;

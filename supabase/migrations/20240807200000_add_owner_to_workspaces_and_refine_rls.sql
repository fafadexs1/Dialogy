
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'workspaces'
    AND column_name = 'owner_id'
  ) THEN
    -- Add the 'owner_id' column to the 'workspaces' table
    -- It defaults to the ID of the user who created it and references your users table.
    ALTER TABLE public.workspaces
    ADD COLUMN owner_id uuid DEFAULT auth.uid() REFERENCES public.users(id);
  END IF;
END $$;


-- First, remove old policies to avoid conflicts.
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;

-- Workspace Policies
-- 1. INSERT: Authenticated users can create workspaces.
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

-- 2. SELECT: Users can see workspaces they are members of.
CREATE POLICY "Users can view workspaces they are members of"
ON public.workspaces FOR SELECT
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

-- 3. UPDATE: Only the workspace owner can update it.
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
USING (owner_id = auth.uid());

-- 4. DELETE: Only the workspace owner can delete it.
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
USING (owner_id = auth.uid());


-- User_Workspaces Policies
-- Clean up old policies first
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow workspace creator linking via trigger" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;


-- 1. INSERT: An authenticated user can add themselves to a workspace.
CREATE POLICY "Users can add themselves to workspaces"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);


-- 2. SELECT: Users can view their own workspace memberships.
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

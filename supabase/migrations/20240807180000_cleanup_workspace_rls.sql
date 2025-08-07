-- Drop all existing policies on the workspaces table to avoid conflicts.
drop policy if exists "Users can create and view their own workspaces" on public.workspaces;
drop policy if exists "Users can see workspaces they are part of" on public.workspaces;
drop policy if exists "Users can view workspaces they are members of" on public.workspaces;
drop policy if exists "Authenticated users can insert workspaces" on public.workspaces;
drop policy if exists "Users can create workspaces" on public.workspaces;

-- Create a single, clear policy for INSERTING workspaces.
-- This allows any authenticated user to create a new workspace.
create policy "Authenticated users can create workspaces"
on public.workspaces for insert to authenticated
with check (true);

-- Create a single, clear policy for SELECTING workspaces.
-- This allows a user to see only the workspaces they are a member of.
create policy "Users can view their own workspaces"
on public.workspaces for select using (
  auth.uid() in (
    select user_id from public.user_workspaces where workspace_id = id
  )
);


-- Add the last_active_workspace_id column to the users table
alter table public.users
add column last_active_workspace_id uuid references public.workspaces(id) on delete set null;

-- Enable RLS for the users table if it's not already enabled
alter table public.users enable row level security;

-- Allow users to read their own data
drop policy if exists "Users can read their own data" on public.users;
create policy "Users can read their own data" on public.users for
select using (auth.uid() = id);

-- Allow users to update their own last_active_workspace_id
drop policy if exists "Users can update their own data" on public.users;
create policy "Users can update their own data" on public.users for
update using (auth.uid() = id) with check (auth.uid() = id);

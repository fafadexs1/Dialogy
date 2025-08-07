-- 1. DROP EXISTING OBJECTS IN REVERSE ORDER OF DEPENDENCY
-- Drop policies first
DROP POLICY IF EXISTS "Users can access API instances of workspaces they are part of" ON storage.objects;
DROP POLICY IF EXISTS "Users can access API instances of workspaces they are part of" ON public.evolution_api_instances;
DROP POLICY IF EXISTS "Users can access API configs of workspaces they are part of" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Users can access messages of workspaces they are part of" ON public.messages;
DROP POLICY IF EXISTS "Users can access chats of workspaces they are part of" ON public.chats;
DROP POLICY IF EXISTS "Users can access contacts of workspaces they are part of" ON public.contacts;
DROP POLICY IF EXISTS "Users can delete their own or be deleted by owner" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert themselves into workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;

-- Drop triggers before functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;

-- Drop functions
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();

-- Drop tables in reverse order of foreign keys
DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.user_workspaces;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;

-- 2. RECREATE TABLES

-- Users Table (Public Profile)
CREATE TABLE public.users (
    id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    avatar_url text,
    email text UNIQUE,
    last_active_workspace_id uuid
);

-- Workspaces Table
CREATE TABLE public.workspaces (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    name text NOT NULL,
    avatar_url text,
    owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);

-- User-Workspace Junction Table
CREATE TABLE public.user_workspaces (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
);

-- Contacts Table
CREATE TABLE public.contacts (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    name text NOT NULL,
    email text,
    phone text,
    avatar_url text,
    business_profile jsonb
);

-- Chats Table
CREATE TABLE public.chats (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES public.users(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'gerais'::text
);

-- Messages Table
CREATE TABLE public.messages (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL, -- Can be a user or a contact, not enforced by FK
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    content text NOT NULL
);

-- Evolution API Config Table
CREATE TABLE public.evolution_api_configs (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    api_url text,
    api_key text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Evolution API Instances Table
CREATE TABLE public.evolution_api_instances (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id uuid NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL, -- 'baileys' or 'wa_cloud'
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 3. RECREATE FUNCTIONS AND TRIGGERS

-- Function to create a public user profile from auth user
CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, full_name, email, avatar_url)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$;

-- Trigger to call handle_new_user on new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to set the workspace owner
CREATE FUNCTION public.set_workspace_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  new.owner_id := auth.uid();
  RETURN new;
END;
$$;

-- Trigger to set owner before workspace insert
CREATE TRIGGER set_workspace_owner_trigger
  BEFORE INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_owner();

-- Function to add the creator as a member of the workspace
CREATE FUNCTION public.add_creator_to_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (new.owner_id, new.id);
  RETURN new;
END;
$$;

-- Trigger to add creator to workspace after insert
CREATE TRIGGER add_creator_to_workspace_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_to_workspace();


-- 4. ENABLE RLS AND CREATE POLICIES

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;

-- Policies for public.users
CREATE POLICY "Users can read their own data" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own data" ON public.users
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  
CREATE POLICY "Allow authenticated users to read users table" ON public.users
  FOR SELECT TO authenticated USING (true);

-- Policies for public.workspaces
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces
  FOR SELECT TO authenticated USING (
    id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
  );

CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Owners can update their own workspaces" ON public.workspaces
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can delete their own workspaces" ON public.workspaces
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Policies for public.user_workspaces
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert themselves into workspaces" ON public.user_workspaces
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own or be deleted by owner" ON public.user_workspaces
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR 
    (SELECT owner_id FROM public.workspaces WHERE id = user_workspaces.workspace_id) = auth.uid()
  );

-- Helper function to check workspace membership
CREATE OR REPLACE FUNCTION is_member_of_workspace(p_workspace_id uuid, p_user_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_workspaces
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id
  );
$$;

-- Policies for related tables (contacts, chats, messages, etc.)
CREATE POLICY "Users can access contacts of workspaces they are part of" ON public.contacts
  FOR ALL USING (is_member_of_workspace(workspace_id, auth.uid())) WITH CHECK (is_member_of_workspace(workspace_id, auth.uid()));

CREATE POLICY "Users can access chats of workspaces they are part of" ON public.chats
  FOR ALL USING (is_member_of_workspace(workspace_id, auth.uid())) WITH CHECK (is_member_of_workspace(workspace_id, auth.uid()));

CREATE POLICY "Users can access messages of workspaces they are part of" ON public.messages
  FOR ALL USING (is_member_of_workspace(workspace_id, auth.uid())) WITH CHECK (is_member_of_workspace(workspace_id, auth.uid()));

CREATE POLICY "Users can access API configs of workspaces they are part of" ON public.evolution_api_configs
  FOR ALL USING (is_member_of_workspace(workspace_id, auth.uid())) WITH CHECK (is_member_of_workspace(workspace_id, auth.uid()));

CREATE POLICY "Users can access API instances of workspaces they are part of" ON public.evolution_api_instances
  FOR ALL USING (
    config_id IN (
      SELECT id FROM public.evolution_api_configs
      WHERE is_member_of_workspace(workspace_id, auth.uid())
    )
  ) WITH CHECK (
    config_id IN (
      SELECT id FROM public.evolution_api_configs
      WHERE is_member_of_workspace(workspace_id, auth.uid())
    )
  );


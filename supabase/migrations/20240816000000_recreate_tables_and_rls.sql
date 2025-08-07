
-- Full script to reset and recreate the core application schema.
-- This script is designed to be run from a clean state or to reset the existing state.
-- It is idempotent, meaning it can be run multiple times without causing errors.

DO $$
BEGIN

RAISE NOTICE 'Starting teardown of existing database objects...';

-- Step 1: Drop dependent objects (Triggers, Policies) first.
-- This is crucial to avoid dependency errors when dropping tables and functions.

-- Drop Triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;

-- Drop Policies
DROP POLICY IF EXISTS "Allow full access to own user data" ON public.users;
DROP POLICY IF EXISTS "Allow read access to other users" ON public.users;
DROP POLICY IF EXISTS "Allow full access based on workspace membership" ON public.workspaces;
DROP POLICY IF EXISTS "Allow full access based on workspace membership" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.contacts;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.chats;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.messages;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Allow full access based on parent config" ON public.evolution_api_instances;


-- Step 2: Drop the functions that the triggers depended on.
DROP FUNCTION IF EXISTS public.create_user_profile();
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();


-- Step 3: Break the circular dependency between users and workspaces
-- The users table has a foreign key to workspaces, and workspaces has one to users.
-- We must remove one of the constraints before dropping the tables.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS fk_last_active_workspace;


-- Step 4: Drop the tables in the correct order to respect dependencies.
-- Start with tables that have foreign keys, then the tables they point to.
DROP TABLE IF EXISTS public.user_workspaces;
DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;

RAISE NOTICE 'Teardown complete. Starting schema recreation...';

--------------------------------------------------------------------------------
-- SECTION: USER AND WORKSPACE MANAGEMENT SYSTEM
--------------------------------------------------------------------------------
RAISE NOTICE 'Creating user and workspace tables...';

-- Users Table: Stores user profile information, linked to auth.users.
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    email TEXT UNIQUE,
    last_active_workspace_id UUID
);

-- Workspaces Table: Represents a workspace where teams collaborate.
CREATE TABLE public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name TEXT NOT NULL,
    avatar_url TEXT,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);

-- Junction Table for Many-to-Many relationship between users and workspaces.
CREATE TABLE public.user_workspaces (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
);

-- Add the foreign key constraint back to users for last_active_workspace_id
ALTER TABLE public.users
ADD CONSTRAINT fk_last_active_workspace
FOREIGN KEY (last_active_workspace_id)
REFERENCES public.workspaces(id) ON DELETE SET NULL;


--------------------------------------------------------------------------------
-- SECTION: CRM AND COMMUNICATION SYSTEM
--------------------------------------------------------------------------------
RAISE NOTICE 'Creating CRM and communication tables...';

-- Contacts Table: Stores information about external contacts (customers).
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    avatar_url TEXT
);

-- Chats Table: Represents a conversation with a contact.
CREATE TABLE public.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'atendimentos'
);

-- Messages Table: Stores individual messages within a chat.
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL, -- Can be a user (agent) or a contact
    content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


--------------------------------------------------------------------------------
-- SECTION: INTEGRATIONS SCHEMA
--------------------------------------------------------------------------------
RAISE NOTICE 'Creating integration tables...';

-- Evolution API Configs Table: Stores API configuration for each workspace.
CREATE TABLE public.evolution_api_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    api_url TEXT,
    api_key TEXT
);

-- Evolution API Instances Table: Stores specific instances for a config.
CREATE TABLE public.evolution_api_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'baileys'
);

--------------------------------------------------------------------------------
-- SECTION: AUTOMATION AND TRIGGERS
--------------------------------------------------------------------------------
RAISE NOTICE 'Creating functions and triggers...';

-- Function to create a user profile upon new user signup
CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  RETURN new;
END;
$$;

-- Trigger to execute the profile creation function
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_user_profile();


-- Function to automatically add the workspace creator to the user_workspaces table
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (new.owner_id, new.id);
  RETURN new;
END;
$$;

-- Trigger to execute the membership function on new workspace creation
CREATE TRIGGER add_creator_to_workspace_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_to_workspace();


--------------------------------------------------------------------------------
-- SECTION: ROW LEVEL SECURITY (RLS) POLICIES
--------------------------------------------------------------------------------
RAISE NOTICE 'Enabling RLS and creating policies...';

-- Enable RLS for all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;


-- Function to check if a user is a member of a workspace
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id UUID, p_user_id UUID)
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

-- Policies for 'users' table
CREATE POLICY "Allow full access to own user data" ON public.users
  FOR ALL USING (auth.uid() = id);
CREATE POLICY "Allow read access to other users" ON public.users
  FOR SELECT USING (true); -- Allows reading basic user info (e.g., for avatars, names)

-- Policies for 'workspaces' table
CREATE POLICY "Allow full access based on workspace membership" ON public.workspaces
  FOR ALL USING (is_workspace_member(id, auth.uid()))
  WITH CHECK (is_workspace_member(id, auth.uid()));

-- Policies for 'user_workspaces' table
CREATE POLICY "Allow full access based on workspace membership" ON public.user_workspaces
  FOR ALL USING (is_workspace_member(workspace_id, auth.uid()));

-- Policies for all workspace-specific data tables
CREATE POLICY "Allow full access to workspace data" ON public.contacts
  FOR ALL USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Allow full access to workspace data" ON public.chats
  FOR ALL USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Allow full access to workspace data" ON public.messages
  FOR ALL USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Allow full access to workspace data" ON public.evolution_api_configs
  FOR ALL USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Allow full access based on parent config" ON public.evolution_api_instances
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.evolution_api_configs c
      WHERE c.id = config_id AND is_workspace_member(c.workspace_id, auth.uid())
    )
  );

RAISE NOTICE 'Database setup complete!';

END $$;

-- =================================================================
--  Workspace Collaboration System Schema
--
--  This script will create all necessary tables, functions, triggers,
--  and security policies for the application.
-- =================================================================

-- Start transaction
BEGIN;

-- =================================================================
--  Schema: public
-- =================================================================

-- Drop existing objects in the correct order to avoid dependency errors.
-- This makes the script idempotent.

-- 1. Drop Triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;

-- 2. Drop Policies
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.contacts;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.chats;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.messages;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Allow full access based on parent config" ON public.evolution_api_instances;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can only create workspaces for themselves" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own user_workspaces entries" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow public read access to users" ON public.users;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

-- 3. Drop Functions
DROP FUNCTION IF EXISTS public.create_user_profile();
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();
DROP FUNCTION IF EXISTS public.is_member_of_workspace(uuid, uuid);


-- 4. Drop Tables
-- Break potential circular dependency before dropping tables
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS fk_last_active_workspace;

DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.user_workspaces;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;


-- =================================================================
--  Table: users
--  Stores user profile information.
-- =================================================================
CREATE TABLE public.users (
    id uuid NOT NULL PRIMARY KEY,
    full_name text,
    avatar_url text,
    email text UNIQUE,
    last_active_workspace_id uuid,
    online boolean DEFAULT false
);

COMMENT ON TABLE public.users IS 'Stores user profile information.';

-- =================================================================
--  Table: workspaces
--  Stores workspace information.
-- =================================================================
CREATE TABLE public.workspaces (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    avatar_url text,
    owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.workspaces IS 'Stores workspace information.';

-- Add the foreign key constraint from users to workspaces now that workspaces table exists.
ALTER TABLE public.users
ADD CONSTRAINT fk_last_active_workspace
FOREIGN KEY (last_active_workspace_id)
REFERENCES public.workspaces(id)
ON DELETE SET NULL;


-- =================================================================
--  Table: user_workspaces
--  Joins users and workspaces to manage membership.
-- =================================================================
CREATE TABLE public.user_workspaces (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
);
COMMENT ON TABLE public.user_workspaces IS 'Manages user membership in workspaces.';


-- =================================================================
--  Table: contacts
--  Stores contact information specific to a workspace.
-- =================================================================
CREATE TABLE public.contacts (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    avatar_url text,
    email text,
    phone text,
    last_seen text,
    business_profile jsonb
);

COMMENT ON TABLE public.contacts IS 'Stores contact information for each workspace.';


-- =================================================================
--  Table: chats
--  Stores chat sessions.
-- =================================================================
CREATE TABLE public.chats (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'atendimentos'
);

COMMENT ON TABLE public.chats IS 'Stores chat sessions within a workspace.';

-- =================================================================
--  Table: messages
--  Stores individual chat messages.
-- =================================================================
CREATE TABLE public.messages (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL, -- Can be a user or contact ID, not enforced by FK to allow flexibility
    content text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messages IS 'Stores individual messages for each chat.';

-- =================================================================
--  Table: evolution_api_configs
--  Stores Evolution API configurations for each workspace.
-- =================================================================
CREATE TABLE public.evolution_api_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    api_url text,
    api_key text
);

COMMENT ON TABLE public.evolution_api_configs IS 'Stores Evolution API global settings for a workspace.';


-- =================================================================
--  Table: evolution_api_instances
--  Stores Evolution API instances.
-- =================================================================
CREATE TABLE public.evolution_api_instances (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    config_id uuid NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
    name text NOT NULL,
    status text DEFAULT 'disconnected',
    type text
);

COMMENT ON TABLE public.evolution_api_instances IS 'Stores individual Evolution API instances.';

-- =================================================================
--  Functions and Triggers
-- =================================================================

-- Function to check if a user is a member of a workspace
CREATE OR REPLACE FUNCTION public.is_member_of_workspace(p_user_id uuid, p_workspace_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_workspaces
    WHERE user_id = p_user_id AND workspace_id = p_workspace_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function to create a user profile upon new auth.user creation
CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, full_name, avatar_url, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call create_user_profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_user_profile();


-- Function to automatically set the workspace owner
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS TRIGGER AS $$
BEGIN
  NEW.owner_id := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call set_workspace_owner
CREATE TRIGGER set_workspace_owner_trigger
  BEFORE INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_owner();


-- Function to add the creator as the first member of a new workspace
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (NEW.owner_id, NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to add creator to workspace
CREATE TRIGGER add_creator_to_workspace_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_to_workspace();


-- =================================================================
--  Row-Level Security (RLS) Policies
-- =================================================================

-- Enable RLS for all relevant tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;


-- Policies for 'users' table
CREATE POLICY "Allow public read access to users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Policies for 'workspaces' table
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces FOR SELECT USING (is_member_of_workspace(auth.uid(), id));
CREATE POLICY "Users can update their own workspaces" ON public.workspaces FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can only create workspaces for themselves" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Policies for 'user_workspaces' table
CREATE POLICY "Users can view their own user_workspaces entries" ON public.user_workspaces FOR SELECT USING (auth.uid() = user_id);

-- Policies for workspace-specific data
CREATE POLICY "Allow full access to workspace data" ON public.contacts FOR ALL USING (is_member_of_workspace(auth.uid(), workspace_id));
CREATE POLICY "Allow full access to workspace data" ON public.chats FOR ALL USING (is_member_of_workspace(auth.uid(), workspace_id));
CREATE POLICY "Allow full access to workspace data" ON public.messages FOR ALL USING (is_member_of_workspace(auth.uid(), workspace_id));
CREATE POLICY "Allow full access to workspace data" ON public.evolution_api_configs FOR ALL USING (is_member_of_workspace(auth.uid(), workspace_id));

-- Policy for 'evolution_api_instances'
CREATE POLICY "Allow full access based on parent config" ON public.evolution_api_instances FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.evolution_api_configs eac
        WHERE eac.id = evolution_api_instances.config_id
        AND is_member_of_workspace(auth.uid(), eac.workspace_id)
    )
);


-- Commit the transaction
COMMIT;

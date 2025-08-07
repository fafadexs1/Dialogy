-- supabase/migrations/20240816000000_recreate_tables_and_rls.sql

-- Workspace Access Control System & Collaboration Schema
-- This script completely tears down and rebuilds the core schema for a multi-tenant workspace system.
-- It establishes clear ownership and membership, with robust Row-Level Security (RLS) policies
-- to ensure data isolation between workspaces.

BEGIN;

-- 1. Teardown existing objects to ensure a clean slate.
-- The order is critical to avoid dependency errors.
RAISE NOTICE 'Starting teardown of existing database objects...';

-- Drop policies first, as they depend on tables.
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.contacts;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.chats;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.messages;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Allow full access based on parent config" ON public.evolution_api_instances;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Allow workspace owners to manage members" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can update their own profiles" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;

-- Drop triggers before functions, as triggers depend on functions.
DROP TRIGGER IF EXISTS on_public_users_created ON public.users;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;

-- Drop functions.
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();

-- Break circular dependency between users and workspaces before dropping tables.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS fk_last_active_workspace;

-- Drop tables in the correct order of dependency.
DROP TABLE IF EXISTS public.user_workspaces;
DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;

RAISE NOTICE 'Teardown complete.';

-- 2. Create Tables
RAISE NOTICE 'Creating tables...';

-- Users table
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    email TEXT UNIQUE,
    last_active_workspace_id UUID
);
COMMENT ON TABLE public.users IS 'Stores user profile information, extending the auth.users table.';

-- Workspaces table
CREATE TABLE public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.workspaces IS 'Stores workspace information, with a clear owner.';

-- Add the foreign key constraint from users to workspaces for last_active_workspace_id
ALTER TABLE public.users
ADD CONSTRAINT fk_last_active_workspace FOREIGN KEY (last_active_workspace_id)
REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- user_workspaces join table for many-to-many relationship
CREATE TABLE public.user_workspaces (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
);
COMMENT ON TABLE public.user_workspaces IS 'Manages user membership in workspaces.';

-- Contacts table
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.contacts IS 'Stores contact information, isolated by workspace.';

-- Chats table
CREATE TABLE public.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'atendimentos',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.chats IS 'Represents a conversation, linked to a workspace, contact, and agent.';

-- Messages table
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL, -- Can be a user (agent) or a contact
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.messages IS 'Stores individual chat messages within a conversation.';

-- Evolution API Configs table
CREATE TABLE public.evolution_api_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    api_url TEXT,
    api_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.evolution_api_configs IS 'Stores Evolution API connection settings for each workspace.';

-- Evolution API Instances table
CREATE TABLE public.evolution_api_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'baileys' or 'wa_cloud'
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.evolution_api_instances IS 'Stores individual WhatsApp instances linked to a configuration.';

RAISE NOTICE 'Tables created successfully.';

-- 3. Helper Functions and Triggers
RAISE NOTICE 'Creating helper functions and triggers...';

-- Function to create a user profile upon new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.users (id, full_name, avatar_url, email)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url', new.email);
  RETURN new;
END;
$$;
COMMENT ON FUNCTION public.handle_new_user IS 'Automatically creates a profile in public.users when a new user signs up in auth.users.';

-- Trigger for handle_new_user
CREATE TRIGGER on_public_users_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to set the owner of a new workspace
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.workspaces
  SET owner_id = auth.uid()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.set_workspace_owner IS 'Sets the owner_id of a new workspace to the currently authenticated user.';

-- Trigger for set_workspace_owner
CREATE TRIGGER set_workspace_owner_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_owner();

-- Function to add the creator as a member of the workspace
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (auth.uid(), NEW.id);
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.add_creator_to_workspace IS 'Automatically adds the user who created a workspace to its member list.';

-- Trigger for add_creator_to_workspace
CREATE TRIGGER add_creator_to_workspace_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_to_workspace();

RAISE NOTICE 'Functions and triggers created successfully.';

-- 4. Enable Row-Level Security (RLS)
RAISE NOTICE 'Enabling Row-Level Security...';
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;
RAISE NOTICE 'RLS enabled.';

-- 5. Create RLS Policies
RAISE NOTICE 'Creating RLS policies...';

-- Users Table Policies
CREATE POLICY "Users can update their own profiles" ON public.users
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Allow authenticated users to read users table" ON public.users
  FOR SELECT TO authenticated USING (true);

-- Workspaces Table Policies
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
  );
CREATE POLICY "Owners can update their own workspaces" ON public.workspaces
  FOR UPDATE USING (auth.uid() = owner_id);

-- User_Workspaces Table Policies
CREATE POLICY "Allow workspace owners to manage members" ON public.user_workspaces
  FOR ALL USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces
  FOR SELECT USING (auth.uid() = user_id);

-- Helper function to check if a user is a member of a workspace
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_workspaces
    WHERE workspace_id = p_workspace_id AND user_id = auth.uid()
  );
$$;

-- Contacts, Chats, Messages, etc. Policies
CREATE POLICY "Allow full access to workspace data" ON public.contacts
  FOR ALL USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Allow full access to workspace data" ON public.chats
  FOR ALL USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Allow full access to workspace data" ON public.messages
  FOR ALL USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Allow full access to workspace data" ON public.evolution_api_configs
  FOR ALL USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Allow full access based on parent config" ON public.evolution_api_instances
  FOR ALL USING (
    config_id IN (
      SELECT id FROM public.evolution_api_configs WHERE public.is_workspace_member(workspace_id)
    )
  );

RAISE NOTICE 'RLS policies created successfully.';
RAISE NOTICE 'Migration script completed.';

COMMIT;

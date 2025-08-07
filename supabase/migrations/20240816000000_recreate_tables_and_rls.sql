-- supabase/migrations/20240816000000_recreate_tables_and_rls.sql

-- Workspace Collaboration System Schema
-- This script performs a full teardown and recreation of the core application tables,
-- including users, workspaces, and related entities. It establishes a robust
-- Role-Based Access Control (RBAC) system using Row-Level Security (RLS) policies
-- and automates critical data management tasks with database triggers and functions.

-- =============================================
-- SECTION 1: Teardown existing objects
-- =============================================
-- To ensure a clean slate, we drop existing objects in the reverse order of dependency.
-- Policies and Triggers are dropped first, as they depend on tables and functions.

-- Drop Policies first to remove dependencies on tables
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.contacts;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.chats;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.messages;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Allow full access based on parent config" ON public.evolution_api_instances;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can only see their own user record" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;


-- Drop Triggers next, as they depend on functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_workspace_created_add_user ON public.workspaces;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;

-- Drop Functions, as they are dependencies for triggers
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();
DROP FUNCTION IF EXISTS public.set_workspace_owner();

-- Temporarily remove foreign key constraint to break circular dependency
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS fk_last_active_workspace;

-- Drop Tables in the correct dependency order
DROP TABLE IF EXISTS public.user_workspaces;
DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;


-- =============================================
-- SECTION 2: Table Creation
-- =============================================

-- User Profile Management
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    email TEXT UNIQUE,
    last_active_workspace_id UUID
);
COMMENT ON TABLE public.users IS 'Stores public-facing user profile information.';

-- Workspace Collaboration System Schema
CREATE TABLE public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name TEXT NOT NULL,
    avatar_url TEXT,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);
COMMENT ON TABLE public.workspaces IS 'Represents a collaborative environment for teams.';

-- Add the foreign key constraint back to users table
ALTER TABLE public.users
ADD CONSTRAINT fk_last_active_workspace
FOREIGN KEY (last_active_workspace_id)
REFERENCES public.workspaces(id)
ON DELETE SET NULL;

-- User-Workspace Membership
CREATE TABLE public.user_workspaces (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
);
COMMENT ON TABLE public.user_workspaces IS 'Associates users with the workspaces they are members of.';

-- Contacts/CRM
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chats
CREATE TABLE public.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'gerais',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages
CREATE TABLE public.messages (
    id BIGSERIAL PRIMARY KEY,
    chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL, -- Can be a user (agent) or contact
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evolution API Config
CREATE TABLE public.evolution_api_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
    api_url TEXT,
    api_key TEXT
);

-- Evolution API Instances
CREATE TABLE public.evolution_api_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL
);


-- =============================================
-- SECTION 3: Workspace Access Control System (RLS)
-- =============================================

-- Enable Row-Level Security on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;

-- Workspace Security Policies
CREATE POLICY "Users can view workspaces they are a member of"
ON public.workspaces FOR SELECT
USING (
  id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
USING (owner_id = auth.uid());

-- User_Workspaces Security Policies
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
USING (user_id = auth.uid());

-- User Security Policies
CREATE POLICY "Users can only see their own user record"
ON public.users FOR SELECT
USING (id = auth.uid());

CREATE POLICY "Users can update their own profile"
ON public.users FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());


-- Generic Policies for Workspace-contained data
CREATE POLICY "Allow full access to workspace data"
ON public.contacts FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Allow full access to workspace data"
ON public.chats FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Allow full access to workspace data"
ON public.messages FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Allow full access to workspace data"
ON public.evolution_api_configs FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Allow full access based on parent config"
ON public.evolution_api_instances FOR ALL
USING (
    config_id IN (
        SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
            SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
        )
    )
);

-- =============================================
-- SECTION 4: Automation (Triggers and Functions)
-- =============================================

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

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- Function to set the workspace owner
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This function is now a placeholder as ownership is set at creation.
  -- The trigger ensures RLS is aware of the owner immediately.
  -- Future ownership logic could be placed here.
  RETURN NEW;
END;
$$;

-- Function to add the creator as a member of the workspace
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (NEW.owner_id, NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger to add creator to workspace members after creation
CREATE TRIGGER on_workspace_created_add_user
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_to_workspace();

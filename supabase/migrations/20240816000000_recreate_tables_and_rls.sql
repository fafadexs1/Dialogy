-- 1. DROP existing objects to ensure a clean slate.
-- The order is important to respect dependencies.

-- Drop Policies before Tables
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can delete their own or be deleted by owner" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can access contacts of workspaces they are part of" ON public.contacts;
DROP POLICY IF EXISTS "Users can access chats of workspaces they are part of" ON public.chats;
DROP POLICY IF EXISTS "Users can access messages of workspaces they are part of" ON public.messages;
DROP POLICY IF EXISTS "Users can access API configs of workspaces they are part of" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Users can access API instances of workspaces they are part of" ON public.evolution_api_instances;

-- Drop Triggers before Functions/Tables they depend on
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces;
DROP TRIGGER IF EXISTS on_workspace_created_add_user ON public.workspaces;

-- Drop Functions
DROP FUNCTION IF EXISTS public.handle_new_user_public();
DROP FUNCTION IF EXISTS public.set_workspace_owner();
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();

-- Drop Tables in the correct dependency order
DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.user_workspaces;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;

-- 2. Recreate all tables

-- Users Table
CREATE TABLE public.users (
    id uuid NOT NULL,
    full_name text,
    email text,
    avatar_url text,
    last_active_workspace_id uuid,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Workspaces Table
CREATE TABLE public.workspaces (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    avatar_url text,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspaces_pkey PRIMARY KEY (id),
    CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- Add foreign key constraint from users to workspaces after workspaces table is created
ALTER TABLE public.users
ADD CONSTRAINT fk_last_active_workspace
FOREIGN KEY (last_active_workspace_id)
REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- User-Workspaces Junction Table
CREATE TABLE public.user_workspaces (
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_workspaces_pkey PRIMARY KEY (user_id, workspace_id),
    CONSTRAINT user_workspaces_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT user_workspaces_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- Contacts Table
CREATE TABLE public.contacts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contacts_pkey PRIMARY KEY (id),
    CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- Chats Table
CREATE TABLE public.chats (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    agent_id uuid,
    status text DEFAULT 'gerais'::text NOT NULL, -- 'atendimentos', 'gerais', 'encerrados'
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chats_pkey PRIMARY KEY (id),
    CONSTRAINT chats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chats_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
    CONSTRAINT chats_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Messages Table
CREATE TABLE public.messages (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_pkey PRIMARY KEY (id),
    CONSTRAINT messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE,
    CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
    -- Note: sender_id can be a user or a contact, so we don't enforce a direct FK constraint here.
);

-- Evolution API Config Table
CREATE TABLE public.evolution_api_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    api_url text,
    api_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evolution_api_configs_pkey PRIMARY KEY (id),
    CONSTRAINT evolution_api_configs_workspace_id_key UNIQUE (workspace_id),
    CONSTRAINT evolution_api_configs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- Evolution API Instances Table
CREATE TABLE public.evolution_api_instances (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    config_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL, -- 'baileys' or 'wa_cloud'
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evolution_api_instances_pkey PRIMARY KEY (id),
    CONSTRAINT evolution_api_instances_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE
);

-- 3. Recreate functions and triggers

-- Function to create a user profile when a new user signs up in auth.users
CREATE FUNCTION public.handle_new_user_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.users (id, full_name, email, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

-- Trigger for handle_new_user_public
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_public();

-- Function to set workspace owner on insert
CREATE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  new.owner_id := auth.uid();
  return new;
end;
$$;

-- Trigger for set_workspace_owner
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW EXECUTE PROCEDURE public.set_workspace_owner();

-- Function to add the creator as a member of the workspace
CREATE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  return new;
end;
$$;

-- Trigger for add_creator_to_workspace
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE PROCEDURE public.add_creator_to_workspace();

-- 4. Re-enable RLS and create policies

-- Enable RLS for all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;

-- Policies for users table
CREATE POLICY "Users can read their own data" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own data" ON public.users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Allow authenticated users to read users table" ON public.users FOR SELECT TO authenticated USING (true);

-- Policies for workspaces table
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces FOR SELECT USING (
    id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);
CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces FOR INSERT WITH CHECK (true);
CREATE POLICY "Owners can update their own workspaces" ON public.workspaces FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can delete their own workspaces" ON public.workspaces FOR DELETE USING (auth.uid() = owner_id);

-- Policies for user_workspaces table
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own workspace memberships" ON public.user_workspaces FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own or be deleted by owner" ON public.user_workspaces FOR DELETE USING (
    (auth.uid() = user_id) OR
    (EXISTS (
        SELECT 1
        FROM public.workspaces w
        WHERE w.id = user_workspaces.workspace_id AND w.owner_id = auth.uid()
    ))
);

-- Policies for contacts, chats, messages (workspace-based access)
CREATE POLICY "Users can access contacts of workspaces they are part of" ON public.contacts FOR ALL USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);
CREATE POLICY "Users can access chats of workspaces they are part of" ON public.chats FOR ALL USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);
CREATE POLICY "Users can access messages of workspaces they are part of" ON public.messages FOR ALL USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);

-- Policies for evolution_api_configs and instances
CREATE POLICY "Users can access API configs of workspaces they are part of" ON public.evolution_api_configs FOR ALL USING (
    workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
);
CREATE POLICY "Users can access API instances of workspaces they are part of" ON public.evolution_api_instances FOR ALL USING (
    config_id IN (
        SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
            SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
        )
    )
);

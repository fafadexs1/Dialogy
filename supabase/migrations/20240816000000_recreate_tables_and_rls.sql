-- Início do Script de Recriação Total

-- Etapa 1: Remover Políticas de Segurança (RLS) existentes para quebrar dependências
-- É crucial remover políticas antes de remover as tabelas que elas referenciam.
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be deleted by owner" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;
DROP POLICY IF EXISTS "Users can access contacts of workspaces they are part of" ON public.contacts;
DROP POLICY IF EXISTS "Users can access chats of workspaces they are part of" ON public.chats;
DROP POLICY IF EXISTS "Users can access messages of workspaces they are part of" ON public.messages;
DROP POLICY IF EXISTS "Users can access API configs of workspaces they are part of" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Users can access API instances of workspaces they are part of" ON public.evolution_api_instances;


-- Etapa 2: Remover Tabelas existentes na ordem correta de dependência
-- Tabelas dependentes primeiro
DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.user_workspaces;
-- A tabela 'users' depende de 'workspaces', então ela deve ser removida antes.
DROP TABLE IF EXISTS public.users;
-- A tabela 'workspaces' é a mais independente neste fluxo.
DROP TABLE IF EXISTS public.workspaces;


-- Etapa 3: Recriar Tabelas com a estrutura correta

-- Tabela `workspaces`
CREATE TABLE public.workspaces (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    name text NOT NULL,
    avatar_url text NULL,
    owner_id uuid NOT NULL,
    CONSTRAINT workspaces_pkey PRIMARY KEY (id)
);

-- Tabela `users` (substitui a tabela `profiles`)
CREATE TABLE public.users (
    id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    full_name text NULL,
    avatar_url text NULL,
    email text NULL,
    last_active_workspace_id uuid NULL,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_last_active_workspace FOREIGN KEY (last_active_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL
);
ALTER TABLE public.workspaces ADD CONSTRAINT fk_owner FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


-- Tabela `user_workspaces` (associação)
CREATE TABLE public.user_workspaces (
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_workspaces_pkey PRIMARY KEY (user_id, workspace_id),
    CONSTRAINT user_workspaces_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT user_workspaces_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- Tabela `contacts`
CREATE TABLE public.contacts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    name text NOT NULL,
    email text NULL,
    phone text NULL,
    avatar_url text NULL,
    CONSTRAINT contacts_pkey PRIMARY KEY (id),
    CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- Tabela `chats`
CREATE TABLE public.chats (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    agent_id uuid NULL,
    status text NOT NULL DEFAULT 'atendimentos'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT chats_pkey PRIMARY KEY (id),
    CONSTRAINT chats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chats_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
    CONSTRAINT chats_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Tabela `messages`
CREATE TABLE public.messages (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT messages_pkey PRIMARY KEY (id),
    CONSTRAINT messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE,
    CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
    -- sender_id pode ser um user ou um contact, então não usamos FK direta aqui
);

-- Tabela `evolution_api_configs`
CREATE TABLE public.evolution_api_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    api_url text NULL,
    api_key text NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT evolution_api_configs_pkey PRIMARY KEY (id),
    CONSTRAINT evolution_api_configs_workspace_id_key UNIQUE (workspace_id),
    CONSTRAINT evolution_api_configs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- Tabela `evolution_api_instances`
CREATE TABLE public.evolution_api_instances (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    config_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT evolution_api_instances_pkey PRIMARY KEY (id),
    CONSTRAINT evolution_api_instances_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE
);


-- Etapa 4: Habilitar RLS em todas as tabelas
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;


-- Etapa 5: Recriar Políticas de Segurança (RLS)

-- Policies para `workspaces`
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces
    FOR SELECT TO authenticated USING (id IN (
        SELECT user_workspaces.workspace_id FROM public.user_workspaces WHERE user_workspaces.user_id = auth.uid()
    ));

CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Owners can update their own workspaces" ON public.workspaces
    FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can delete their own workspaces" ON public.workspaces
    FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Policies para `user_workspaces`
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own workspace memberships" ON public.user_workspaces
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can be deleted by owner" ON public.user_workspaces
    FOR DELETE TO authenticated USING ((user_id = auth.uid()) OR (workspace_id IN (
        SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )));

-- Policies para `users`
CREATE POLICY "Users can update their own data" ON public.users
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow authenticated users to read users table" ON public.users
    FOR SELECT TO authenticated USING (true);


-- Policies genéricas para tabelas ligadas a um workspace
CREATE POLICY "Users can access contacts of workspaces they are part of" ON public.contacts
    FOR ALL USING (workspace_id IN (
        SELECT user_workspaces.workspace_id FROM public.user_workspaces WHERE user_workspaces.user_id = auth.uid()
    ));

CREATE POLICY "Users can access chats of workspaces they are part of" ON public.chats
    FOR ALL USING (workspace_id IN (
        SELECT user_workspaces.workspace_id FROM public.user_workspaces WHERE user_workspaces.user_id = auth.uid()
    ));

CREATE POLICY "Users can access messages of workspaces they are part of" ON public.messages
    FOR ALL USING (workspace_id IN (
        SELECT user_workspaces.workspace_id FROM public.user_workspaces WHERE user_workspaces.user_id = auth.uid()
    ));

-- Policies para `evolution_api_*`
CREATE POLICY "Users can access API configs of workspaces they are part of" ON public.evolution_api_configs
    FOR ALL USING (workspace_id IN (
        SELECT user_workspaces.workspace_id FROM public.user_workspaces WHERE user_workspaces.user_id = auth.uid()
    ));

CREATE POLICY "Users can access API instances of workspaces they are part of" ON public.evolution_api_instances
    FOR ALL USING (config_id IN (
        SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
            SELECT user_workspaces.workspace_id FROM public.user_workspaces WHERE user_workspaces.user_id = auth.uid()
        )
    ));

-- Etapa 6: Recriar Funções e Triggers
-- Função para criar um perfil de usuário público
CREATE OR REPLACE FUNCTION public.handle_new_user_public()
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

-- Trigger para chamar a função acima quando um novo usuário se registra
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_public();

-- Função para definir o proprietário do workspace
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
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

-- Trigger para definir o proprietário ao criar um workspace
CREATE TRIGGER set_workspace_owner_trigger
  BEFORE INSERT ON public.workspaces
  FOR EACH ROW EXECUTE PROCEDURE public.set_workspace_owner();

-- Função para adicionar o criador como membro do workspace
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
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

-- Trigger para adicionar o criador como membro
CREATE TRIGGER add_creator_to_workspace_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE PROCEDURE public.add_creator_to_workspace();

-- Fim do Script

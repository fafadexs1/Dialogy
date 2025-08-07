-- supabase/migrations/20240816000000_recreate_tables_and_rls.sql

-- Inicia a transação
BEGIN;

-- 1. Remove todas as políticas de RLS existentes para evitar conflitos de dependência
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Allow authenticated users to read users table" ON public.users;
DROP POLICY IF EXISTS "Allow all users to read users" ON public.users;
DROP POLICY IF EXISTS "Users can access contacts of workspaces they are part of" ON public.contacts;
DROP POLICY IF EXISTS "Users can access chats of workspaces they are part of" ON public.chats;
DROP POLICY IF EXISTS "Users can access messages of workspaces they are part of" ON public.messages;
DROP POLICY IF EXISTS "Users can access API configs of workspaces they are part of" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Users can access API instances of workspaces they are part of" ON public.evolution_api_instances;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert themselves into workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can delete their own or be deleted by owner" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow users to join workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow users to see their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can add themselves to workspaces" ON public.user_workspaces;

-- 2. Remove a restrição de chave estrangeira para quebrar a dependência circular
ALTER TABLE IF EXISTS public.users DROP CONSTRAINT IF EXISTS fk_last_active_workspace;

-- 3. Remove as tabelas existentes na ordem correta de dependência
DROP TABLE IF EXISTS public.evolution_api_instances;
DROP TABLE IF EXISTS public.evolution_api_configs;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chats;
DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.user_workspaces;
DROP TABLE IF EXISTS public.workspaces;
DROP TABLE IF EXISTS public.users;

-- 4. Recria as tabelas com a estrutura correta

-- Tabela de Usuários (Agentes)
CREATE TABLE public.users (
    id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    email text UNIQUE,
    avatar_url text,
    last_active_workspace_id uuid
);
COMMENT ON TABLE public.users IS 'Stores user profile information, linking to authentication.';

-- Tabela de Workspaces
CREATE TABLE public.workspaces (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    avatar_url text
);
COMMENT ON TABLE public.workspaces IS 'Stores workspace information, owned by a user.';

-- Adiciona a restrição de chave estrangeira de volta para users
ALTER TABLE public.users
ADD CONSTRAINT fk_last_active_workspace
FOREIGN KEY (last_active_workspace_id)
REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- Tabela de Associação (Muitos-para-Muitos entre Users e Workspaces)
CREATE TABLE public.user_workspaces (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
);
COMMENT ON TABLE public.user_workspaces IS 'Associates users with workspaces.';

-- Tabela de Contatos (Clientes)
CREATE TABLE public.contacts (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    email text,
    phone text,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.contacts IS 'Stores contact information within a workspace.';

-- Tabela de Chats
CREATE TABLE public.chats (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'gerais', -- ex: 'atendimentos', 'gerais', 'encerrados'
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.chats IS 'Represents a conversation between a contact and an agent.';

-- Tabela de Mensagens
CREATE TABLE public.messages (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL, -- Pode ser um user.id ou um contact.id. Não há FK para flexibilidade.
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.messages IS 'Stores individual messages within a chat.';

-- Tabela de Configurações da Evolution API
CREATE TABLE public.evolution_api_configs (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    api_url text,
    api_key text,
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.evolution_api_configs IS 'Stores Evolution API configurations for a workspace.';

-- Tabela de Instâncias da Evolution API
CREATE TABLE public.evolution_api_instances (
    id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id uuid NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL, -- 'baileys' ou 'wa_cloud'
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.evolution_api_instances IS 'Stores individual Evolution API instances linked to a configuration.';


-- 5. Habilita RLS em todas as tabelas
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;


-- 6. Cria as Políticas de RLS

-- Tabela `users`
CREATE POLICY "Users can read their own data" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own data" ON public.users
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
    
CREATE POLICY "Allow authenticated users to read users table" ON public.users
    FOR SELECT TO authenticated USING (true);


-- Tabela `workspaces`
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces
    FOR SELECT TO authenticated USING (
        id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    );

CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces
    FOR INSERT TO authenticated WITH CHECK (true); -- Trigger cuidará do owner_id

CREATE POLICY "Owners can update their own workspaces" ON public.workspaces
    FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can delete their own workspaces" ON public.workspaces
    FOR DELETE TO authenticated USING (owner_id = auth.uid());


-- Tabela `user_workspaces`
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert themselves into workspaces" ON public.user_workspaces
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own or be deleted by owner" ON public.user_workspaces
    FOR DELETE TO authenticated USING (
        (user_id = auth.uid()) OR 
        (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()))
    );


-- Políticas para tabelas relacionadas ao Workspace
CREATE POLICY "Users can access data in workspaces they are part of" ON public.contacts
    FOR ALL USING (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    ) WITH CHECK (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can access data in workspaces they are part of" ON public.chats
    FOR ALL USING (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    ) WITH CHECK (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can access data in workspaces they are part of" ON public.messages
    FOR ALL USING (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    ) WITH CHECK (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can access data in workspaces they are part of" ON public.evolution_api_configs
    FOR ALL USING (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    ) WITH CHECK (
        workspace_id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can access data in workspaces they are part of" ON public.evolution_api_instances
    FOR ALL USING (
        config_id IN (SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
            SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
        ))
    ) WITH CHECK (
        config_id IN (SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
            SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
        ))
    );


-- 7. Recria as funções e triggers
-- Função para criar um perfil de usuário público quando um novo usuário se registra
DROP FUNCTION IF EXISTS public.handle_new_user_public();
CREATE OR REPLACE FUNCTION public.handle_new_user_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Trigger para a função acima
DROP TRIGGER IF EXISTS on_auth_user_created_public ON auth.users;
CREATE TRIGGER on_auth_user_created_public
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_public();

-- Função para definir o proprietário do workspace
DROP FUNCTION IF EXISTS public.set_workspace_owner();
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
AS $$
begin
  new.owner_id := auth.uid();
  return new;
end;
$$;

-- Trigger para a função acima
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
CREATE TRIGGER set_workspace_owner_trigger
  BEFORE INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_owner();

-- Função para adicionar o criador como membro do workspace
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
AS $$
begin
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  return new;
end;
$$;

-- Trigger para a função acima
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
CREATE TRIGGER add_creator_to_workspace_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_to_workspace();


COMMIT;

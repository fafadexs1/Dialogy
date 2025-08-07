-- 1. Trigger para definir o proprietário do workspace
-- Remove o trigger antigo primeiro
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;

-- Remove a função
DROP FUNCTION IF EXISTS public.set_workspace_owner();

-- Cria a função
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  -- Define o owner_id como o ID do usuário autenticado que está fazendo a inserção
  -- O RLS já garante que apenas usuários autenticados podem chegar aqui.
  new.owner_id := auth.uid();
  return new;
end;
$$;

-- Cria o trigger
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();


-- 2. Trigger para adicionar o criador como membro do workspace
-- Remove os triggers antigos primeiro (usando os nomes que podem ter sido criados em tentativas anteriores)
DROP TRIGGER IF EXISTS on_workspace_created_add_user ON public.workspaces;
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;

-- Remove a função antiga
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();

-- Cria a função
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  -- Insere o criador (auth.uid()) na tabela de associação user_workspaces
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  return new;
end;
$$;

-- Cria o novo trigger
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- 3. Políticas de RLS para Workspaces
-- Remove políticas antigas para evitar conflitos
DROP POLICY IF EXISTS "Authenticated users can insert workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;

-- Permite que usuários autenticados criem workspaces (o owner_id será definido pelo trigger)
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated WITH CHECK (true);

-- Permite que usuários vejam os workspaces dos quais são membros
CREATE POLICY "Users can view workspaces they are a member of"
ON public.workspaces FOR SELECT
TO authenticated USING (id IN (
  SELECT workspace_id FROM user_workspaces WHERE user_id = auth.uid()
));

-- Permite que o proprietário atualize o workspace
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Permite que o proprietário exclua o workspace
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
TO authenticated USING (owner_id = auth.uid());


-- 4. Políticas de RLS para User_Workspaces
-- Remove políticas antigas para evitar conflitos
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert themselves into workspaces" ON public.user_workspaces;

-- Permite que os usuários vejam suas próprias associações de workspace
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated USING (user_id = auth.uid());

-- Permite que o trigger (executando como o usuário) insira a associação
-- A verificação garante que um usuário só pode se adicionar.
CREATE POLICY "Users can insert themselves into workspaces"
ON public.user_workspaces FOR INSERT
TO authenticated WITH CHECK (user_id = auth.uid());

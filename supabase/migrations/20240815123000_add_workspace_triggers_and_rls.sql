-- 1. Função para definir o proprietário do workspace
DROP FUNCTION IF EXISTS public.set_workspace_owner();
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

-- 2. Trigger para definir o proprietário do workspace
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();

-- 3. Função para adicionar o criador como membro do workspace
DROP FUNCTION IF EXISTS public.add_creator_to_workspace();
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

-- 4. Trigger para adicionar o criador ao workspace
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();

-- 5. Políticas de RLS para `workspaces`
-- Habilita RLS na tabela `workspaces` se ainda não estiver habilitado
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem criar workspaces. O owner_id será definido pelo trigger.
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);

-- Usuários podem visualizar os workspaces dos quais são membros.
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
CREATE POLICY "Users can view workspaces they are a member of"
ON public.workspaces FOR SELECT
TO authenticated
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

-- Proprietários podem atualizar seus próprios workspaces.
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Proprietários podem deletar seus próprios workspaces.
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
TO authenticated
USING (owner_id = auth.uid());


-- 6. Políticas de RLS para `user_workspaces`
-- Habilita RLS na tabela `user_workspaces` se ainda não estiver habilitado
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver suas próprias associações de workspace.
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Impede inserções diretas, pois o trigger cuidará disso. Poderíamos permitir que donos adicionem outros usuários,
-- mas por enquanto, vamos manter simples e seguro.
DROP POLICY IF EXISTS "No direct inserts into user_workspaces" ON public.user_workspaces;
-- CREATE POLICY "No direct inserts into user_workspaces"
-- ON public.user_workspaces FOR INSERT
-- TO authenticated
-- WITH CHECK (false); -- Desabilita inserção direta

-- Proprietários de workspaces podem remover membros (ou membros podem se remover).
DROP POLICY IF EXISTS "Users can delete their own or be deleted by owner" ON public.user_workspaces;
CREATE POLICY "Users can delete their own or be deleted by owner"
ON public.user_workspaces FOR DELETE
TO authenticated
USING (
    user_id = auth.uid() -- O usuário pode se remover
    OR
    -- O proprietário do workspace pode remover qualquer um
    (SELECT owner_id FROM public.workspaces WHERE id = user_workspaces.workspace_id) = auth.uid()
);

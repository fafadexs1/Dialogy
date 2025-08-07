-- Garante que o RLS está ativado
alter table public.workspaces enable row level security;
alter table public.user_workspaces enable row level security;

-- Remove políticas antigas ou duplicadas para evitar conflitos
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert themselves into workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can add themselves to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow users to join workspaces" ON public.user_workspaces;

-- Recria as políticas com uma lógica clara
-- Qualquer usuário autenticado pode tentar inserir um workspace. O owner_id será definido pelo trigger.
CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Um usuário só pode ver os workspaces dos quais é membro.
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces
  FOR SELECT TO authenticated
  USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
  ));

-- Apenas o proprietário pode atualizar o workspace.
CREATE POLICY "Owners can update their own workspaces" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Função para definir o proprietário do workspace
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  -- Define o owner_id como o ID do usuário autenticado que está fazendo a inserção
  new.owner_id := auth.uid();
  return new;
end;
$$;

-- Trigger para definir o proprietário ANTES da inserção
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();

-- Função para adicionar o criador como membro do workspace
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  -- Insere o criador (auth.uid()) na tabela de associação user_workspaces
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  return new;
end;
$$;

-- Trigger para adicionar o criador DEPOIS da inserção do workspace
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- Política para a tabela de associação user_workspaces
-- Permite que um usuário veja suas próprias associações
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- O trigger add_creator_to_workspace cuidará da inserção inicial.
-- Políticas de INSERT/DELETE em user_workspaces podem ser mais restritivas.
-- Por enquanto, vamos garantir que o sistema funcione com os triggers.
-- Esta política de INSERT para user_workspaces não é mais estritamente necessária se o trigger fizer tudo, mas a mantemos para clareza.
CREATE POLICY "Users can be added to workspaces" ON public.user_workspaces
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

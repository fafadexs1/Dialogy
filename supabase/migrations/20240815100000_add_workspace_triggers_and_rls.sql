-- Remove políticas antigas para evitar conflitos
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can insert own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;


-- 1. Função para definir o proprietário do workspace automaticamente
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    NEW.owner_id := auth.uid();
    RETURN NEW;
END;
$$;

-- 2. Trigger para definir o proprietário antes de inserir um workspace
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();


-- 3. Função para adicionar o criador como membro do workspace
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.user_workspaces (user_id, workspace_id)
    VALUES (NEW.owner_id, NEW.id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

-- 4. Trigger para adicionar o criador como membro após a inserção do workspace
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- 5. Ativar RLS nas tabelas se ainda não estiver ativado
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;


-- 6. Políticas de Segurança para a tabela `workspaces`

-- Permite que qualquer usuário autenticado crie um workspace. O trigger cuidará do owner_id.
CREATE POLICY "Authenticated users can create workspaces"
    ON public.workspaces
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Permite que usuários vejam os workspaces dos quais são membros.
CREATE POLICY "Users can view their own workspaces"
    ON public.workspaces
    FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT workspace_id
            FROM public.user_workspaces
            WHERE user_id = auth.uid()
        )
    );

-- Permite que o proprietário (owner) atualize seu próprio workspace.
CREATE POLICY "Owners can update their own workspaces"
    ON public.workspaces
    FOR UPDATE
    TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Permite que o proprietário (owner) exclua seu próprio workspace.
CREATE POLICY "Owners can delete their own workspaces"
    ON public.workspaces
    FOR DELETE
    TO authenticated
    USING (owner_id = auth.uid());


-- 7. Políticas de Segurança para a tabela `user_workspaces`

-- Permite que um usuário se adicione a um workspace (necessário para convites no futuro)
-- e que o proprietário do workspace adicione outros usuários.
CREATE POLICY "Users can insert their own workspace memberships"
    ON public.user_workspaces
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid() OR
        (
            SELECT owner_id FROM public.workspaces WHERE id = workspace_id
        ) = auth.uid()
    );

-- Permite que usuários vejam suas próprias associações.
CREATE POLICY "Users can view their own workspace memberships"
    ON public.user_workspaces
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Permite que usuários se removam de um workspace ou que o dono remova outros.
CREATE POLICY "Users can delete their own or be deleted by owner"
    ON public.user_workspaces
    FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid() OR
        (
            SELECT owner_id FROM public.workspaces WHERE id = workspace_id
        ) = auth.uid()
    );


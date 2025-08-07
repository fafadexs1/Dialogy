
-- ========== LIMPEZA DE POLÍTICAS ANTIGAS ==========
-- Remove todas as políticas conflitantes ou duplicadas das tabelas `workspaces` e `user_workspaces`
DROP POLICY IF EXISTS "Allow authenticated users to create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Allow users to view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can insert own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create and view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can see workspaces they are part of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;

DROP POLICY IF EXISTS "Allow workspace creator linking via trigger" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;

-- ========== ADICIONAR COLUNA owner_id (SE NÃO EXISTIR) ==========
-- Garante que a coluna 'owner_id' exista antes de criar políticas que dependem dela.
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'workspaces'
    AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE public.workspaces
    ADD COLUMN owner_id uuid REFERENCES public.users(id);
  END IF;
END $$;


-- ========== TRIGGER 1: DEFINIR O DONO DO WORKSPACE AUTOMATICAMENTE ==========

-- Função que define o `owner_id` como o `auth.uid()` do usuário que está fazendo a inserção.
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Define o owner_id da nova linha com o ID do usuário autenticado.
  NEW.owner_id := auth.uid();
  RETURN NEW;
END;
$$;

-- Trigger que executa a função acima ANTES de um INSERT na tabela `workspaces`.
DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
CREATE TRIGGER set_workspace_owner_trigger
BEFORE INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_owner();


-- ========== TRIGGER 2: ADICIONAR CRIADOR COMO MEMBRO DO WORKSPACE ==========

-- Função que insere o criador do workspace na tabela de junção `user_workspaces`.
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insere um registro na tabela `user_workspaces` para vincular o usuário (criador) ao novo workspace.
  INSERT INTO public.user_workspaces (user_id, workspace_id)
  VALUES (auth.uid(), NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger que executa a função acima DEPOIS de um INSERT na tabela `workspaces`.
DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
CREATE TRIGGER add_creator_to_workspace_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_to_workspace();


-- ========== APLICAÇÃO DAS POLÍTICAS DE SEGURANÇA CORRETAS ==========

-- --- Tabela: workspaces ---
-- 1. Habilita a RLS na tabela `workspaces`.
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- 2. Política de INSERT: Permite que qualquer usuário autenticado insira um novo workspace.
-- O trigger `set_workspace_owner_trigger` garantirá que a verificação `owner_id = auth.uid()` sempre passe.
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

-- 3. Política de SELECT: Permite que um usuário visualize um workspace se ele for membro.
CREATE POLICY "Users can view workspaces they are a member of"
ON public.workspaces FOR SELECT
TO authenticated
USING (id IN (SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()));

-- 4. Política de UPDATE: Permite que um usuário atualize um workspace apenas se ele for o proprietário.
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
TO authenticated
USING (owner_id = auth.uid());

-- 5. Política de DELETE: Permite que um usuário exclua um workspace apenas se ele for o proprietário.
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
TO authenticated
USING (owner_id = auth.uid());


-- --- Tabela: user_workspaces ---
-- 1. Habilita a RLS na tabela `user_workspaces`.
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;

-- 2. Política de INSERT: Permite que um usuário se adicione a um workspace.
-- Esta política é necessária para o trigger `add_creator_to_workspace_trigger` funcionar corretamente.
CREATE POLICY "Users can insert themselves into workspaces"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 3. Política de SELECT: Permite que um usuário veja suas próprias associações de workspace.
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());

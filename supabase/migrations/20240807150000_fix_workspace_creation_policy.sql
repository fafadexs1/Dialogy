-- Remove a política antiga e excessivamente restritiva.
DROP POLICY IF EXISTS "Users can see and create workspaces they are part of" ON public.workspaces;

-- Cria uma nova política que permite a QUALQUER usuário autenticado CRIAR um workspace.
-- No entanto, a visualização (SELECT) continua restrita apenas aos membros do workspace.
CREATE POLICY "Users can create and view their own workspaces"
ON public.workspaces
FOR ALL
USING (
  -- O usuário pode ver (SELECT) o workspace se for membro dele.
  auth.uid() IN (SELECT user_id FROM public.user_workspaces WHERE workspace_id = id)
)
WITH CHECK (
  -- O usuário pode criar (INSERT) um workspace se estiver logado.
  auth.uid() IS NOT NULL
);

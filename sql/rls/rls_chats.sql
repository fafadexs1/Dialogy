-- Habilitar RLS na tabela chats
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- Política de Leitura (SELECT)
-- Usuários podem ver chats se pertencerem ao workspace do chat
CREATE POLICY "Users can view chats from their workspaces"
ON public.chats
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = chats.workspace_id
  )
);

-- Política de Inserção (INSERT)
-- Usuários podem criar chats em seus workspaces
CREATE POLICY "Users can insert chats in their workspaces"
ON public.chats
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = chats.workspace_id
  )
);

-- Política de Atualização (UPDATE)
-- Usuários podem atualizar chats em seus workspaces (ex: assumir chat, fechar chat)
CREATE POLICY "Users can update chats in their workspaces"
ON public.chats
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = chats.workspace_id
  )
);

-- Política de Deleção (DELETE)
-- Usuários podem deletar chats em seus workspaces (cuidado: cascade delete)
CREATE POLICY "Users can delete chats in their workspaces"
ON public.chats
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = chats.workspace_id
  )
);

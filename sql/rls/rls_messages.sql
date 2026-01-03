-- Habilitar RLS na tabela messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Política de Leitura (SELECT)
-- Usuários podem ver mensagens se pertencerem ao workspace da mensagem
CREATE POLICY "Users can view messages from their workspaces"
ON public.messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = messages.workspace_id
  )
);

-- Política de Inserção (INSERT)
-- Usuários podem inserir mensagens em seus workspaces
CREATE POLICY "Users can insert messages to their workspaces"
ON public.messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = messages.workspace_id
  )
);

-- Política de Atualização (UPDATE)
-- Usuários podem atualizar mensagens em seus workspaces (ex: marcar como lida, soft delete)
CREATE POLICY "Users can update messages in their workspaces"
ON public.messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = messages.workspace_id
  )
);

-- Política de Deleção (DELETE)
-- Usuários podem deletar mensagens em seus workspaces
CREATE POLICY "Users can delete messages in their workspaces"
ON public.messages
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_workspace_roles uwr
    WHERE uwr.user_id = auth.uid()
    AND uwr.workspace_id = messages.workspace_id
  )
);

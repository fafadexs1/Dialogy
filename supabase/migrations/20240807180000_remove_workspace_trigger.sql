
-- Remover o gatilho da tabela de workspaces, se existir.
drop trigger if exists on_workspace_created on public.workspaces;

-- Remover a função do gatilho, se existir.
drop function if exists public.link_creator_to_workspace();

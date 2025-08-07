-- Adiciona a coluna last_active_workspace_id à tabela users
alter table public.users
add column last_active_workspace_id uuid references public.workspaces(id) on delete set null;

-- Políticas de Segurança para a nova coluna na tabela users
-- Os usuários podem ler seu próprio last_active_workspace_id (já coberto pela política de SELECT existente)
-- Os usuários podem atualizar seu próprio last_active_workspace_id
drop policy if exists "Users can update their own data" on public.users;

create policy "Users can update their own data"
on public.users for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- A política de SELECT existente já permite que o usuário leia seus próprios dados, o que inclui a nova coluna.
-- Apenas para garantir que ela exista e esteja correta:
drop policy if exists "Users can read their own data" on public.users;

create policy "Users can read their own data"
on public.users for select
using (auth.uid() = id);

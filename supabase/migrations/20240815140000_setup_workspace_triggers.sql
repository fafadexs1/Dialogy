
-- 1. Função para definir o proprietário do workspace
create or replace function public.set_workspace_owner()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Define o owner_id como o ID do usuário autenticado que está fazendo a inserção
  -- O RLS já garante que apenas usuários autenticados podem chegar aqui.
  new.owner_id := auth.uid();
  return new;
end;
$$;

-- 2. Trigger para chamar a função antes de inserir um workspace
drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  before insert on public.workspaces
  for each row execute procedure public.set_workspace_owner();


-- 3. Função para adicionar o criador como membro do workspace
create or replace function public.add_creator_to_workspace()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Insere o criador (auth.uid()) na tabela de associação user_workspaces
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  return new;
end;
$$;

-- 4. Trigger para chamar a função depois de inserir um workspace
drop trigger if exists on_workspace_created_add_user on public.workspaces;
create trigger on_workspace_created_add_user
  after insert on public.workspaces
  for each row execute procedure public.add_creator_to_workspace();

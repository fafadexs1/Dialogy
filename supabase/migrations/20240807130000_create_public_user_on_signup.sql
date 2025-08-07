-- supabase/migrations/20240807130000_create_public_user_on_signup.sql

-- Função para criar uma entrada na tabela `public.users` quando um novo usuário se registra no `auth.users`
create or replace function public.handle_new_user_public()
returns trigger as $$
begin
  insert into public.users (id, full_name, email, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Gatilho para acionar a função `handle_new_user_public` após a criação de um novo usuário
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user_public();

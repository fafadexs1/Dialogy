CREATE SCHEMA IF NOT EXISTS auth;

-- Creates a trigger function that inserts a new row into public.users
-- whenever a new user is created in the auth.users table.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, full_name, email, avatar_url, password_hash)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    new.encrypted_password -- Store the encrypted password
  );
  return new;
end;
$$ language plpgsql security definer;

-- Creates the trigger that fires the handle_new_user function
-- after a new user is inserted into auth.users.
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

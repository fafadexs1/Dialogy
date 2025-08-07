-- supabase/migrations/20240807120000_remove_profiles_trigger.sql

-- Drop the trigger on auth.users if it exists
drop trigger if exists on_auth_user_created on auth.users;

-- Drop the function that the trigger called if it exists
drop function if exists public.handle_new_user();

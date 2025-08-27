import { createClient } from '@supabase/supabase-js';

// Separate admin client for server-side operations that require elevated privileges
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

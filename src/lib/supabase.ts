import { createClient } from '@supabase/supabase-js';

// Supabase client for browser-side usage. Expect environment variables to be set.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

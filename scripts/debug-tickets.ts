import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Use service role key to bypass RLS for debugging
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    console.log('Checking support_tickets table...');

    // Check total count
    const { count, error: countError } = await supabase
        .from('support_tickets')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        console.error('Error counting tickets:', countError);
    } else {
        console.log(`Total tickets in DB: ${count}`);
    }

    // List first 5
    const { data, error } = await supabase
        .from('support_tickets')
        .select('id, subject, user_id, status')
        .limit(5);

    if (error) {
        console.error('Error fetching tickets:', error);
    } else {
        console.log('Sample tickets:', data);
    }
}

check();

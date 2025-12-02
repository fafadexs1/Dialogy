
import { db } from '@/lib/db';

export async function checkDatabaseSchema() {
    try {
        console.log('Checking columns for tables...');
        const columns = await db.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name IN ('messages', 'chats', 'user_workspace_presence')
            AND column_name = 'workspace_id';
        `);
        console.log('Columns found:', columns.rows);

        console.log('Checking publications...');
        const publications = await db.query(`
            SELECT pubname, schemaname, tablename 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
            AND tablename IN ('messages', 'chats', 'user_workspace_presence');
        `);
        console.log('Publications found:', publications.rows);

        return { columns: columns.rows, publications: publications.rows };
    } catch (error) {
        console.error('Error checking DB:', error);
        return { error };
    }
}

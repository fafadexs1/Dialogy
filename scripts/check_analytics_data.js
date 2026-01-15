
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkMysteryChats() {
  try {
    console.log('Analyzing chats without meta_conversations...');

    // Check JID suffix for chats that are NOT in meta_conversations
    const res = await pool.query(`
      SELECT 
        CASE 
            WHEN ct.phone_number_jid LIKE '%@s.whatsapp.net' THEN 'WhatsApp JID'
            WHEN ct.phone_number_jid LIKE '%@g.us' THEN 'WhatsApp Group'
            WHEN ct.phone_number_jid IS NULL OR ct.phone_number_jid = '' THEN 'No JID'
            ELSE 'Other JID'
        END as contact_type,
        COUNT(*) as count
      FROM chats c
      LEFT JOIN meta_conversations mc ON c.id = mc.chat_id
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      WHERE mc.id IS NULL
      GROUP BY 1
      ORDER BY 2 DESC
    `);

    console.log('Contact Type Breakdown (JSON):');
    console.log(JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkMysteryChats();

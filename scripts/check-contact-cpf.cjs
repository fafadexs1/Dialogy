const { Pool } = require('pg');
require('dotenv').config({ quiet: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const contact = (await pool.query("SELECT * FROM contacts WHERE phone LIKE '%5561995215930%'")).rows[0];
  console.log('Contact:', contact.id, contact.name, contact.phone);
  const values = (await pool.query("SELECT * FROM contact_custom_field_values WHERE contact_id=$1", [contact.id])).rows;
  console.log('Values:', values);
  const fields = (await pool.query("SELECT * FROM contact_custom_fields WHERE workspace_id=$1", [contact.workspace_id])).rows;
  console.log('Fields:', fields.map(f => ({ id: f.id, name: f.name, key: f.key })));
})().catch(console.error).finally(() => pool.end());

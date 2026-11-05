import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { saveSgpContactDocumentIfEmpty } from '@/modules/nexus/services/sgp-contact-document';

async function main() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Session-local tables shadow application tables; production contacts are untouched.
    await client.query(`CREATE TEMP TABLE contacts (id text PRIMARY KEY, workspace_id text) ON COMMIT DROP;
      CREATE TEMP TABLE chats (id text PRIMARY KEY, workspace_id text, contact_id text) ON COMMIT DROP;
      CREATE TEMP TABLE workspace_integrations (workspace_id text, provider text, is_active boolean, config jsonb) ON COMMIT DROP;
      CREATE TEMP TABLE custom_field_definitions (id text PRIMARY KEY, workspace_id text) ON COMMIT DROP;
      CREATE TEMP TABLE contact_custom_field_values (contact_id text, field_id text, value text, UNIQUE(contact_id,field_id)) ON COMMIT DROP;`);
    await client.query(`INSERT INTO contacts VALUES ('contact-a','workspace-a'),('contact-b','workspace-a');
      INSERT INTO chats VALUES ('chat-a','workspace-a','contact-a'),('chat-b','workspace-a','contact-b');
      INSERT INTO custom_field_definitions VALUES ('field-a','workspace-a');
      INSERT INTO workspace_integrations VALUES ('workspace-a','sgp',true,'{"cpfFieldId":"field-a"}');`);
    const target = { workspaceId: 'workspace-a', chatId: 'chat-a', document: '529.982.247-25' };
    assert.equal(await saveSgpContactDocumentIfEmpty(target, client), 'saved');
    assert.deepEqual((await client.query('SELECT * FROM contact_custom_field_values')).rows, [{ contact_id: 'contact-a', field_id: 'field-a', value: '52998224725' }]);
    assert.equal(await saveSgpContactDocumentIfEmpty({ ...target, document: '04.252.011/0001-10' }, client), 'preserved');
    assert.equal(await saveSgpContactDocumentIfEmpty({ ...target, workspaceId: 'workspace-b' }, client), 'unavailable');
    assert.equal(await saveSgpContactDocumentIfEmpty({ ...target, document: '52998224724' }, client), 'unavailable');
    await client.query("INSERT INTO contact_custom_field_values VALUES ('contact-b','field-a','  ')");
    assert.equal(await saveSgpContactDocumentIfEmpty({ ...target, chatId: 'chat-b', document: '04.252.011/0001-10' }, client), 'saved');
    assert.equal((await client.query("SELECT value FROM contact_custom_field_values WHERE contact_id='contact-b'")).rows[0].value, '04252011000110');
    assert.equal((await client.query("SELECT value FROM contact_custom_field_values WHERE contact_id='contact-a'")).rows[0].value, '52998224725');
    await client.query("UPDATE custom_field_definitions SET workspace_id='workspace-b'");
    assert.equal(await saveSgpContactDocumentIfEmpty(target, client), 'unavailable');
    await client.query('ROLLBACK');
    const evidence = { observedAt: new Date().toISOString(), database: 'PostgreSQL temporary tables with rollback',
      cpfInsertedAndReadBack: true, cnpjInsertedAndReadBack: true, existingDocumentPreserved: true,
      otherContactUnchanged: true, wrongWorkspaceRejected: true, wrongFieldWorkspaceRejected: true,
      invalidCheckDigitsRejected: true, productionContactsChanged: 0 };
    await writeFile('docs/sgp-document-persistence-results.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } finally { await client.query('ROLLBACK'); client.release(); await db.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha na verificação.'); process.exitCode = 1; });

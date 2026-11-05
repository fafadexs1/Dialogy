import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
const bridge = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: bridge.query } }));
vi.mock('@/services/agent-studio/repository', () => ({ withStudioTransaction: bridge.transaction }));
import { loadStudioContactCrm } from '@/services/agent-studio/contact-crm';
import { executeStudioContactAction } from '@/services/agent-studio/native-actions';
import { studioContactPhone } from '@/services/agent-studio/contact-phone';
let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  bridge.query.mockImplementation((query, args) => sql.query(query, args));
  bridge.transaction.mockImplementation((fn) => sql.transaction((tx) => fn(tx)));
  await sql.exec(`CREATE TABLE contacts(id text PRIMARY KEY, workspace_id text, name text, phone text, email text, address text, updated_at timestamptz);
    CREATE TABLE workspace_integrations(workspace_id text, provider text, config jsonb, is_active boolean);
    CREATE TABLE chats(id text PRIMARY KEY, workspace_id text, contact_id text);
    CREATE TABLE custom_field_definitions(id text PRIMARY KEY, workspace_id text, label text);
    CREATE TABLE contact_custom_field_values(contact_id text, field_id text, value text, PRIMARY KEY(contact_id,field_id));
    INSERT INTO contacts(id,workspace_id,name) VALUES ('a','w','Original'),('b','w','Outro'),('c','other','Externo');
    INSERT INTO chats VALUES ('chat','w','a'),('chat-b','w','b'),('chat-c','other','c'),('broken','w','c');
    INSERT INTO custom_field_definitions VALUES ('field','w','Plano'),('foreign','other','Privado');
    INSERT INTO contact_custom_field_values VALUES ('a','field','Essencial'),('b','field','Completo'),('a','foreign','Não expor');`);
}, 30000);
afterAll(async () => { await sql?.close(); });
describe('current-conversation CRM scope on isolated PostgreSQL', () => {
  it('reads only the current contact and same-workspace definitions', async () => {
    expect(await loadStudioContactCrm('w','chat')).toEqual({ field: 'Essencial', Plano: 'Essencial' });
    expect(await loadStudioContactCrm('other','chat')).toEqual({});
    expect(await loadStudioContactCrm('w','broken')).toEqual({});
  });
  it('exposes only the document mapped by the current workspace SGP integration', async () => {
    await sql.exec(`INSERT INTO custom_field_definitions VALUES ('document','w','CPF');
      INSERT INTO contact_custom_field_values VALUES ('a','document','52998224725');
      INSERT INTO workspace_integrations VALUES ('w','sgp','{"cpfFieldId":"document"}',true);`);
    expect((await loadStudioContactCrm('w','chat')).sgp_document).toBe('52998224725');
    expect((await loadStudioContactCrm('other','chat-c')).sgp_document).toBeUndefined();
  });
  const update = (apiField: string, value: string, chatId = 'chat', confirmed = true) => executeStudioContactAction({ workspaceId: 'w', chatId, confirmed,
    context: { values: { value }, contact: { id: 'b' } }, step: { id:'save',type:'native_action',order:1,title:'Salvar',nativeActionType:'update_crm_field',
      nativeActionPayload: { contactId:'b' }, nativeDataMappings:[{ apiField,sourceType:'collected_field',sourceValue:'value' }] } });
  it('writes profile and custom fields only to the contact resolved from the chat', async () => {
    await update('contact.name','Atualizado'); await update('field','Novo plano');
    expect((await sql.query('SELECT name FROM contacts WHERE id=$1',['a'])).rows[0]).toEqual({name:'Atualizado'});
    expect((await sql.query('SELECT name FROM contacts WHERE id=$1',['b'])).rows[0]).toEqual({name:'Outro'});
    expect((await loadStudioContactCrm('w','chat')).field).toBe('Novo plano');
  });
  it('rejects foreign contacts, field definitions, invalid data and unconfirmed writes', async () => {
    await expect(update('contact.name','X','broken')).rejects.toThrow();
    await expect(update('foreign','X')).rejects.toThrow();
    await expect(update('contact.workspace_id','other')).rejects.toThrow();
    await expect(update('contact.email','invalid')).rejects.toThrow();
    await expect(update('contact.name','X','chat',false)).rejects.toThrow();
  });
});
describe('phone from channel identity', () => {
  it('uses the real phone and supports a direct WhatsApp JID fallback', () => {
    expect(studioContactPhone({phone:'+55 (61) 99999-9999'})).toBe('5561999999999');
    expect(studioContactPhone({phone_number_jid:'5561999999999@s.whatsapp.net'})).toBe('5561999999999');
  });
  it.each(['webchat:5561999999999','5561999999999@lid','5561999999999@g.us','5561999999999@evil.test'])('does not treat %s as a phone', (jid) => {
    expect(studioContactPhone({phone_number_jid:jid})).toBeUndefined();
  });
});

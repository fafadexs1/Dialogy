import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';

const mocks = vi.hoisted(() => ({ query: vi.fn(), event: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query, connect: async () => ({ query: mocks.query, release() {} }) } }));
vi.mock('@/modules/nexus/services/dialogy-event-dispatcher', () => ({ dispatchDialogyNexusInternalEvent: mocks.event }));
import { executeNexusIntegration } from '@/modules/nexus/services/integration-executors';

const database = new PGlite();
function input(contactId: string, fields: Record<string, string> = { name: 'Atualizado' }) {
  return {
    workflow: { workspaceId: 'workspace-a' },
    node: { id: 'update', type: 'dialogy.crm_update', config: { fields } },
    execution: { executionId: 'exec', input: { contactId }, context: { source: 'internal_event' }, variables: {}, nodeResults: {} },
    input: {}, attachments: {}, signal: new AbortController().signal, emit: vi.fn(),
  } as unknown as NodeRuntimeInput;
}

describe('CRM event actions without a conversation', () => {
  beforeAll(async () => {
    mocks.query.mockImplementation((sql, args) => database.query(sql, args));
    await database.exec(`
      CREATE TABLE contacts (id text PRIMARY KEY, workspace_id text, name text);
      CREATE TABLE custom_field_definitions (id text PRIMARY KEY, workspace_id text, label text);
      CREATE TABLE contact_custom_field_values (contact_id text, field_id text, value text, PRIMARY KEY (contact_id, field_id));
      INSERT INTO contacts VALUES ('contact-a', 'workspace-a', 'Original A'), ('contact-b', 'workspace-b', 'Original B');
      INSERT INTO custom_field_definitions VALUES ('field-b', 'workspace-b', 'Contrato');
    `);
  });
  afterAll(async () => { await database.close(); });

  it('persists a change for a contact in its workspace without a chat', async () => {
    await executeNexusIntegration(input('contact-a'));
    expect((await database.query('SELECT name FROM contacts WHERE id = $1', ['contact-a'])).rows).toEqual([{ name: 'Atualizado' }]);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a', payload: expect.objectContaining({ contactId: 'contact-a' }) }));
  });

  it('rejects a contact belonging to another workspace', async () => {
    await expect(executeNexusIntegration(input('contact-b'))).rejects.toThrow('Contato');
    expect((await database.query('SELECT name FROM contacts WHERE id = $1', ['contact-b'])).rows).toEqual([{ name: 'Original B' }]);
  });

  it('rolls back if a foreign custom field is supplied', async () => {
    await expect(executeNexusIntegration(input('contact-a', { name: 'Must roll back', 'field-b': 'Assinou' }))).rejects.toThrow('Campo personalizado');
    expect((await database.query('SELECT name FROM contacts WHERE id = $1', ['contact-a'])).rows).toEqual([{ name: 'Atualizado' }]);
    expect((await database.query('SELECT * FROM contact_custom_field_values')).rows).toEqual([]);
  });
});

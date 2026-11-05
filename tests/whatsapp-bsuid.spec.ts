import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { isWhatsappBsuid, parseScopedWhatsappBsuid, scopeWhatsappBsuid } from '@/lib/whatsapp/bsuid';
import {
  extractWhatsappDigits, normalizeWhatsappPhoneNumber, normalizeWhatsappJid,
  buildWhatsappLookupJids, findOrCreateWhatsappContact, findWhatsappChatByIdentity,
  lockWhatsappIdentityTransaction,
} from '@/lib/whatsapp/contact-identity';
import { atomizeMetaWhatsappPayload } from '@/services/meta/whatsapp-router';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { sendListMessage } from '@/services/whatsapp/send-list-message';
import { sendButtonsMessage } from '@/services/whatsapp/send-buttons-message';
import { sendTemplateMessage } from '@/services/whatsapp/send-template-message';
import * as bsuidHelpers from '@/lib/whatsapp/bsuid';
import * as contactHelpers from '@/lib/whatsapp/contact-identity';
import * as inboundHelpers from '@/lib/whatsapp/evolution-inbound-message';
import * as mediaHelpers from '@/lib/media-message-type';

const { http, preferred, remember } = vi.hoisted(() => ({ http: vi.fn(), preferred: vi.fn(), remember: vi.fn() }));
vi.mock('@/lib/http/resilient-fetch', () => ({ resilientFetch: http }));
vi.mock('@/lib/whatsapp/number-form-memory', () => ({ getPreferredSendDigits: preferred, rememberSendDigits: remember }));
vi.mock('@/lib/observability/logger', () => ({ withDebug: (_: unknown, fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({ db: {} }));

const USER = 'BR.AbC5561998765432';
const INSTANCE = 'zap3';
const scoped = scopeWhatsappBsuid(USER, INSTANCE);
const config = { api_url: 'https://evolution.example.test', api_key: 'test-key' };
afterEach(() => vi.clearAllMocks());

describe('BSUID identity boundary', () => {
  it('preserves country prefix, parent prefix, full length and case, without phone variants', () => {
    for (const id of [USER, 'US.ENT.' + 'a'.repeat(128)]) {
      const key = scopeWhatsappBsuid(id, 'instance: with space');
      expect(isWhatsappBsuid(id)).toBe(true);
      expect(parseScopedWhatsappBsuid(key)).toEqual({ instanceName: 'instance: with space', userId: id });
      expect(normalizeWhatsappJid(key)).toBe(key);
      expect(buildWhatsappLookupJids(key)).toEqual([key]);
      for (const identity of [id, key]) {
        expect(normalizeWhatsappPhoneNumber(identity)).toBeNull();
        expect(extractWhatsappDigits(identity)).toBe('');
      }
    }
    expect(normalizeWhatsappJid(USER)).toBeNull(); // Raw BSUID needs a trusted instance before persistence.
  });

  it('scopes a BSUID to its instance and preserves existing telephone normalization', () => {
    expect(scopeWhatsappBsuid(USER, 'other')).not.toBe(scoped);
    expect(() => scopeWhatsappBsuid(scoped, 'other')).toThrow('outra instancia');
    expect(normalizeWhatsappPhoneNumber('556198765432')).toBe('5561998765432');
    expect(scopeWhatsappBsuid('5561998765432@s.whatsapp.net', INSTANCE)).toBe('5561998765432@s.whatsapp.net');
  });

  it('raw Meta relay retains only the matching BSUID contact, username and parent ID', () => {
    const contact = { user_id: USER, parent_user_id: 'BR.ENT.Parent', profile: { name: 'Customer', username: '@customer' } };
    const atoms = atomizeMetaWhatsappPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: 'business' }, contacts: [{ user_id: 'BR.Other', wa_id: '5511999999999' }, contact],
      messages: [{ id: 'wamid.in', from_user_id: USER, type: 'text', text: { body: 'hello' } }],
    } }] }] }, 'app');
    const value = (atoms[0].payload as any).entry[0].changes[0].value;
    expect(value.contacts).toEqual([contact]);
    expect(value.messages[0].from_user_id).toBe(USER);
    expect(value.messages[0].from).toBeUndefined();
  });
});

describe('BSUID sending through production service wrappers and API client', () => {
  it('sends text, list, buttons and template to the complete provider identity', async () => {
    http.mockImplementation(async () => Response.json({ key: { id: 'wamid.accepted' } }));
    await sendTextMessage(config, INSTANCE, scoped, 'hello');
    await sendListMessage(config, INSTANCE, { number: scoped, description: 'choose', buttonText: 'Open', sections: [{ title: 'Options', rows: [{ title: 'One', rowId: '1' }] }] });
    await sendButtonsMessage(config, INSTANCE, { number: scoped, title: 'choose', buttons: [{ type: 'reply', displayText: 'One', id: '1' }] });
    await sendTemplateMessage(config, INSTANCE, { number: scoped, name: 'hello_world', language: 'en_US', components: [] });
    expect(http).toHaveBeenCalledTimes(4);
    for (const [, options] of http.mock.calls) expect(JSON.parse(options.body).number).toBe(USER);
    expect(preferred).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it('refuses another instance before issuing an HTTP request', async () => {
    await expect(fetchEvolutionAPI('/message/sendText/other', config, { method: 'POST', body: JSON.stringify({ number: scoped, text: 'hello' }), silent: true })).rejects.toThrow('outra instancia');
    expect(http).not.toHaveBeenCalled();
  });

  it('unwraps reaction destination with the same instance check', async () => {
    http.mockResolvedValue(Response.json({ key: { id: 'reaction' } }));
    await fetchEvolutionAPI(`/message/sendReaction/${INSTANCE}`, config, { method: 'POST', body: JSON.stringify({ key: { id: 'original', remoteJid: scoped }, reaction: '👍' }) });
    expect(JSON.parse(http.mock.calls[0][1].body).key.remoteJid).toBe(USER);
  });

  it('never retries a BSUID by stripping it into Brazilian phone digits', async () => {
    http.mockResolvedValue(new Response('{"exists":false}', { status: 400 }));
    await expect(fetchEvolutionAPI(`/message/sendText/${INSTANCE}`, config, { method: 'POST', body: JSON.stringify({ number: scoped, text: 'hello' }), silent: true })).rejects.toThrow('400');
    expect(http).toHaveBeenCalledTimes(1);
    expect(preferred).not.toHaveBeenCalled();
  });
});

describe('BSUID contact persistence in isolated PostgreSQL', () => {
  it('protects canonical phone indexes, deduplicates conversations and isolates tenants/instances', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE contacts (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, workspace_id TEXT NOT NULL,
        name TEXT NOT NULL, phone TEXT NOT NULL, phone_number_jid TEXT, avatar_url TEXT,
        phone_canonical TEXT, phone_digits TEXT[], created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
        UNIQUE (workspace_id, phone_number_jid)
      );
      CREATE TABLE chats (id TEXT PRIMARY KEY, contact_id TEXT, workspace_id TEXT, status TEXT, agent_id TEXT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(), assigned_at TIMESTAMP, closed_at TIMESTAMP);
      CREATE TABLE messages (id TEXT, chat_id TEXT, created_at TIMESTAMP DEFAULT now());`);
      // This is the actual legacy function inspected read-only in the configured database.
      await db.exec(readFileSync(new URL('./fixtures/contact-phone-digits-legacy.sql', import.meta.url), 'utf8'));
      await db.exec('CREATE TRIGGER tr_contacts_phone_digits BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_contact_phone_digits();');
      await db.exec(readFileSync(new URL('../prisma/migrations/20260913020000_preserve_bsuid_contact_identity/migration.sql', import.meta.url), 'utf8'));
      const client = { query: async (sql: string, values?: any[]) => {
        const result = await db.query(sql, values);
        return { rows: result.rows as any[], rowCount: result.rows.length };
      } };
      await client.query('BEGIN');
      await lockWhatsappIdentityTransaction(client, { workspaceId: 'one', phoneOrJid: scoped });
      const first = await findOrCreateWhatsappContact(client, { workspaceId: 'one', phoneOrJid: scoped, fallbackName: 'Customer', fallbackPhone: USER });
      expect(first.created).toBe(true);
      expect(first.contact.phone).toBe('');
      expect(first.contact.phone_canonical).toBeNull();
      expect(first.contact.phone_digits).toBeNull();
      await client.query("INSERT INTO chats (id,contact_id,workspace_id,status) VALUES ('chat',$1,'one','gerais')", [first.contact.id]);
      const again = await findOrCreateWhatsappContact(client, { workspaceId: 'one', phoneOrJid: scoped });
      expect(again.contact.id).toBe(first.contact.id);
      expect(again.created).toBe(false);
      const chat = await findWhatsappChatByIdentity(client, { workspaceId: 'one', phoneOrJid: scoped, statuses: ['gerais'] });
      expect(chat.id).toBe('chat');
      expect(await findWhatsappChatByIdentity(client, { workspaceId: 'two', phoneOrJid: scoped })).toBeNull();
      const otherInstance = await findOrCreateWhatsappContact(client, { workspaceId: 'one', phoneOrJid: scopeWhatsappBsuid(USER, 'other') });
      expect(otherInstance.contact.id).not.toBe(first.contact.id);
      const otherWorkspace = await findOrCreateWhatsappContact(client, { workspaceId: 'two', phoneOrJid: scoped });
      expect(otherWorkspace.contact.id).not.toBe(first.contact.id);
      const phone = await findOrCreateWhatsappContact(client, { workspaceId: 'one', phoneOrJid: '556198765432', fallbackName: 'Legacy' });
      expect(phone.contact.phone_canonical).toBe('5561998765432');
      expect(phone.contact.phone_digits).toContain('556198765432');
      await client.query('COMMIT');
      // Edits must not reconstruct the fake telephone through the legacy trigger.
      await client.query("UPDATE contacts SET name='Edited' WHERE id=$1", [first.contact.id]);
      expect((await client.query('SELECT phone_canonical FROM contacts WHERE id=$1', [first.contact.id])).rows[0].phone_canonical).toBeNull();
    } finally { await db.close(); }
  }, 20_000);
});

describe('Meta → Evolution → Dialogy inbox → reply contract', () => {
  it.skipIf(!existsSync(new URL('../../evolution-api-main/scripts/meta-bsuid-test-fixture.cjs', import.meta.url)))('runs the actual adapters and inbox handler, persists the customer/message and replies via the original instance', async () => {
    const require = createRequire(import.meta.url);
    const { fixture } = require('../../evolution-api-main/scripts/meta-bsuid-test-fixture.cjs');
    const evolution = fixture();
    const db = new PGlite();
    const deliveredToNexus = vi.fn(async () => ({ handled: true }));
    const processed = vi.fn();
    let pending: any;
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await db.exec(`CREATE TYPE chat_status_enum AS ENUM ('gerais','atendimentos','encerrados');
        CREATE TABLE contacts (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, workspace_id TEXT, name TEXT,
          phone TEXT NOT NULL, phone_number_jid TEXT, avatar_url TEXT, phone_canonical TEXT, phone_digits TEXT[],
          created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(), UNIQUE(workspace_id,phone_number_jid));
        CREATE TABLE chats (id TEXT PRIMARY KEY, workspace_id TEXT, contact_id TEXT, status chat_status_enum,
          protocol TEXT, agent_id TEXT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
          assigned_at TIMESTAMP, closed_at TIMESTAMP);
        CREATE TABLE messages (id TEXT DEFAULT gen_random_uuid()::text, workspace_id TEXT, chat_id TEXT, type TEXT,
          content TEXT, metadata JSONB, message_id_from_api TEXT UNIQUE, sender_from_api TEXT, instance_name TEXT,
          source_from_api TEXT, from_me BOOLEAN, api_message_status TEXT, raw_payload JSONB, created_at TIMESTAMP);
      `);
      await db.exec(readFileSync(new URL('./fixtures/contact-phone-digits-legacy.sql', import.meta.url), 'utf8'));
      await db.exec('CREATE TRIGGER tr_contacts_phone_digits BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_contact_phone_digits();');
      await db.exec(readFileSync(new URL('../prisma/migrations/20260913020000_preserve_bsuid_contact_identity/migration.sql', import.meta.url), 'utf8'));
      const client = {
        query: async (sql: string, values?: any[]) => {
          // Workspace queue settings are unrelated to identity and have no auto-close configured in this fixture.
          if (/queue_auto_close|queueAutoClose/i.test(sql)) return { rows: [], rowCount: 0 };
          const result = await db.query(sql, values);
          return { rows: result.rows as any[], rowCount: result.rows.length };
        },
        release() {},
      };
      const dependencies: Record<string, any> = {
        '@/lib/db': { db: { query: client.query, connect: async () => client } },
        '@/lib/whatsapp/bsuid': bsuidHelpers,
        '@/lib/whatsapp/contact-identity': contactHelpers,
        '@/lib/whatsapp/evolution-inbound-message': inboundHelpers,
        '@/lib/media-message-type': mediaHelpers,
        '@/lib/whatsapp/evolution-config': { getEvolutionApiConfig: async () => config },
        '@/lib/whatsapp/number-form-memory': { rememberSendDigits: async () => {} },
        '@/lib/utils': { sanitizeUrl: (v: unknown) => v, buildChatProtocol: (v: string) => v },
        '@/lib/storage-url': { normalizeStoredMediaUrl: (v: unknown) => v },
        '@/lib/marketing-attribution': { extractAttributionToken: () => null },
        '@/lib/marketing-attribution-server': { attributeInboundWhatsappMessageByProximity: async () => null },
        '@/lib/billing-logic': { getMonthlyChatLimitStatus: async () => ({ allowed: true }) },
        '@/lib/automation-engine': { evaluateAutomations: async () => {} },
        '@/lib/queue': { shouldEnqueueJob: () => false },
        '@/services/webhook-dispatcher': { dispatchMessageToWebhooks: async () => {} },
        '@/modules/nexus/services/message-dispatcher': { dispatchPublishedNexusMessage: deliveredToNexus },
        '@/services/whatsapp/evolution-webhook-inbox': {
          claimEvolutionWebhookEvent: async () => ({ payload: pending }),
          markEvolutionWebhookEventProcessed: processed,
          markEvolutionWebhookEventFailed: (value: any) => { throw value.error; },
        },
      };
      const module = { exports: {} as any };
      const source = readFileSync(new URL('../src/services/whatsapp/evolution-webhook-handler.ts', import.meta.url), 'utf8');
      new Function('require', 'module', 'exports', ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText)((id: string) => dependencies[id] ?? (id === 'crypto' ? require(id) : {}), module, module.exports);

      const [atom] = atomizeMetaWhatsappPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'business-phone' },
        contacts: [{ user_id: USER, profile: { name: 'Customer', username: '@customer' } }],
        messages: [{ id: 'wamid.full-path', from_user_id: USER, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hello' } }],
      } }] }] }, 'app');
      await evolution.service.connectToWhatsapp(atom.payload);
      const webhook = evolution.webhooks.find((w: any) => w.event === 'messages.upsert');
      expect(webhook.data.key.remoteJid).toBe(USER);
      pending = { event: webhook.event, data: webhook.data, instance: INSTANCE, __resolved_workspace_id: 'workspace' };
      await module.exports.processPersistedEvolutionWebhookEvent('delivery', 'test-worker');

      const [contact] = (await db.query('SELECT * FROM contacts')).rows as any[];
      const [message] = (await db.query('SELECT * FROM messages')).rows as any[];
      expect(contact.phone).toBe('');
      expect(contact.phone_canonical).toBeNull();
      expect(contact.phone_number_jid).toBe(scoped);
      expect(message.content).toBe('hello');
      expect(message.metadata.whatsappUserId).toBe(USER);
      expect(message.metadata.whatsappUsername).toBe('@customer');
      expect(message.metadata.evolutionRealtimeSideEffectsEligible).toBe(true);
      expect(deliveredToNexus).toHaveBeenCalledWith(expect.objectContaining({ chatId: message.chat_id, instanceName: INSTANCE, sourceMessageId: message.id }));
      expect(processed).toHaveBeenCalledTimes(1);

      http.mockImplementation(async (_url: string, options: RequestInit) => {
        const result = await evolution.service.textMessage(JSON.parse(String(options.body)));
        return Response.json(result);
      });
      const reply = await sendTextMessage(config, INSTANCE, contact.phone_number_jid, 'reply');
      expect(reply.key.id).toBe('wamid.sent');
      expect(evolution.http[0].payload.recipient).toBe(USER);
      expect(evolution.http[0].payload.to).toBeUndefined();
    } finally {
      logs.mockRestore();
      await db.close();
    }
  }, 25_000);
});

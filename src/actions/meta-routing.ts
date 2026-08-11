'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { decryptPayload as decryptMetaPayload } from '@/services/meta/meta-payload-crypto';

// Legacy mock-file support. These helpers stay private to this module so they
// are not exposed as Server Actions.
const ALGORITHM = 'aes-256-gcm';
function getSecretKey() {
  const envKey = process.env.META_ROUTING_DECRYPT_KEY;
  if (!envKey) throw new Error('META_ROUTING_DECRYPT_KEY is not configured');
  return crypto.createHash('sha256').update(envKey).digest();
}

// User access check
async function checkSuperAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return false;
    return result.rows[0].is_superadmin;
  } catch (err) {
    console.error('[CHECK_SUPERADMIN_ERROR]', err);
    return false;
  }
}

// Check if tables exist
export async function checkTablesExist(): Promise<boolean> {
  try {
    const res = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'meta_whatsapp_waba_routes'
    `);
    return (res.rowCount ?? 0) > 0;
  } catch (e) {
    return false;
  }
}

// Path for mock storage
const MOCK_FILE_PATH = path.join(process.cwd(), 'data', 'meta-routing-mock.json');

// Initialize Mock Data Structure
async function getOrCreateMockData() {
  const dir = path.dirname(MOCK_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const defaultMock = {
    wabaRoutes: [
      {
        waba_id: 'waba-prod-corp-1',
        cluster_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d', // 02 - Hosting Now
        state: 'active',
        version: 3,
        created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      },
      {
        waba_id: 'waba-prod-corp-2',
        cluster_id: '570a7960-dc85-48ac-b05d-a92304da5b12', // 03 - LuraHosting
        state: 'migrating',
        version: 1,
        created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString()
      },
      {
        waba_id: 'waba-old-crm-3',
        cluster_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d',
        state: 'paused',
        version: 2,
        created_at: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      }
    ],
    phoneRoutes: [
      {
        phone_number_id: '15550199999',
        waba_id: 'waba-prod-corp-1',
        instance_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d',
        workspace_id: '00000000-0000-0000-0000-000000000001',
        state: 'active',
        created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      },
      {
        phone_number_id: '15550188888',
        waba_id: 'waba-prod-corp-1',
        instance_id: '0634ca73-4a97-467c-a2a3-05d3b873733e',
        workspace_id: '00000000-0000-0000-0000-000000000002',
        state: 'active',
        created_at: new Date(Date.now() - 25 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      },
      {
        phone_number_id: '15550177777',
        waba_id: 'waba-prod-corp-2',
        instance_id: '570a7960-dc85-48ac-b05d-a92304da5b12',
        workspace_id: '00000000-0000-0000-0000-000000000003',
        state: 'active',
        created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString()
      }
    ],
    deliveries: [
      {
        id: 'dev-del-001',
        event_key: 'evt_msg_9a2b8c7d',
        waba_id: 'waba-prod-corp-1',
        phone_number_id: '15550199999',
        cluster_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d',
        instance_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d',
        status: 'processed',
        encrypted_payload: '', // will be set below
        attempts: 1,
        error_message: null,
        lease_expires_at: null,
        created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 14 * 60 * 1000).toISOString()
      },
      {
        id: 'dev-del-002',
        event_key: 'evt_status_bc3d4e',
        waba_id: 'waba-prod-corp-1',
        phone_number_id: '15550188888',
        cluster_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d',
        instance_id: '0634ca73-4a97-467c-a2a3-05d3b873733e',
        status: 'pending',
        encrypted_payload: '', // will be set below
        attempts: 0,
        error_message: null,
        lease_expires_at: new Date(Date.now() + 120 * 1000).toISOString(),
        created_at: new Date(Date.now() - 5000).toISOString(),
        updated_at: new Date(Date.now() - 5000).toISOString()
      },
      {
        id: 'dev-del-003',
        event_key: 'evt_ambiguous_route',
        waba_id: null,
        phone_number_id: '15550155555',
        cluster_id: null,
        instance_id: null,
        status: 'quarantined',
        encrypted_payload: '', // will be set below
        attempts: 0,
        error_message: 'RoutingError: Phone number ID 15550155555 does not map to any active routes or WABAs. Webhook entry quarantined without fallback.',
        lease_expires_at: null,
        created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      },
      {
        id: 'dev-del-004',
        event_key: 'evt_cluster_timeout',
        waba_id: 'waba-prod-corp-2',
        phone_number_id: '15550177777',
        cluster_id: '570a7960-dc85-48ac-b05d-a92304da5b12',
        instance_id: '570a7960-dc85-48ac-b05d-a92304da5b12',
        status: 'dead_letter',
        encrypted_payload: '', // set below
        attempts: 20,
        error_message: 'ConnectionTimeoutError: Max retries (20) exhausted. Cluster 03 - LuraHosting did not respond after 30 seconds. Retaining payload indefinitely for replay.',
        lease_expires_at: null,
        created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 23 * 3600 * 1000).toISOString()
      },
      {
        id: 'dev-del-005',
        event_key: 'evt_retry_state',
        waba_id: 'waba-prod-corp-1',
        phone_number_id: '15550199999',
        cluster_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d',
        instance_id: 'fae71e53-02c7-4783-adcd-ba4d5a7aa22d',
        status: 'retry',
        encrypted_payload: '',
        attempts: 4,
        error_message: 'HTTPError: 502 Bad Gateway returned from evolution callback endpoint /internal/webhooks/dialogy/meta. Retrying in 120s.',
        lease_expires_at: null,
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 28 * 60 * 1000).toISOString()
      }
    ]
  };

  // Encrypt payloads in mock data
  const p1 = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-prod-corp-1',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511999999999', phone_number_id: '15550199999' },
          contacts: [{ profile: { name: 'João Silva' }, wa_id: '5511999999999' }],
          messages: [{
            from: '5511999999999',
            id: 'ABGGFlCG5sRkAgo-Eb2q14z2',
            timestamp: '1782877080',
            text: { body: 'Olá! Quero saber sobre o plano Pro.' },
            type: 'text'
          }]
        },
        field: 'messages'
      }]
    }]
  };

  const p2 = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-prod-corp-1',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511888888888', phone_number_id: '15550188888' },
          statuses: [{
            id: 'ABGGFlCG5sRkAgo-Eb2q14z2',
            status: 'delivered',
            timestamp: '1782877085',
            recipient_id: '5511888888888'
          }]
        },
        field: 'messages'
      }]
    }]
  };

  const p3 = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'unknown-waba',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511777777777', phone_number_id: '15550155555' },
          messages: [{
            from: '5511777777777',
            id: 'ABGGFlCG5sRkAgo-Eb2q9999',
            timestamp: '1782877000',
            text: { body: 'Mensagem enviada para número sem rota cadastrada!' },
            type: 'text'
          }]
        },
        field: 'messages'
      }]
    }]
  };

  const p4 = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-prod-corp-2',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511666666666', phone_number_id: '15550177777' },
          messages: [{
            from: '5511666666666',
            id: 'ABGGFlCG5sRkAgo-Eb2q8888',
            timestamp: '1782876000',
            text: { body: 'Mensagem de boas-vindas do onboarding.' },
            type: 'text'
          }]
        },
        field: 'messages'
      }]
    }]
  };

  const p5 = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-prod-corp-1',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511999999999', phone_number_id: '15550199999' },
          messages: [{
            from: '5511999999999',
            id: 'ABGGFlCG5sRkAgo-Eb2q2345',
            timestamp: '1782876500',
            text: { body: 'Segunda tentativa de contato.' },
            type: 'text'
          }]
        },
        field: 'messages'
      }]
    }]
  };

  if (!fs.existsSync(MOCK_FILE_PATH)) {
    // Encrypt all payloads synchronously for setup
    const key = getSecretKey();
    const encrypt = (text: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return `${iv.toString('hex')}:${encrypted}:${cipher.getAuthTag().toString('hex')}`;
    };

    defaultMock.deliveries[0].encrypted_payload = encrypt(JSON.stringify(p1));
    defaultMock.deliveries[1].encrypted_payload = encrypt(JSON.stringify(p2));
    defaultMock.deliveries[2].encrypted_payload = encrypt(JSON.stringify(p3));
    defaultMock.deliveries[3].encrypted_payload = encrypt(JSON.stringify(p4));
    defaultMock.deliveries[4].encrypted_payload = encrypt(JSON.stringify(p5));

    fs.writeFileSync(MOCK_FILE_PATH, JSON.stringify(defaultMock, null, 2), 'utf8');
    return defaultMock;
  }

  const fileData = fs.readFileSync(MOCK_FILE_PATH, 'utf8');
  try {
    return JSON.parse(fileData);
  } catch (e) {
    fs.writeFileSync(MOCK_FILE_PATH, JSON.stringify(defaultMock, null, 2), 'utf8');
    return defaultMock;
  }
}

async function saveMockData(data: any) {
  fs.writeFileSync(MOCK_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export type MetaRoutingOverview = {
  dbConnected: boolean;
  statistics: {
    pendingCount: number;
    quarantineCount: number;
    dlqCount: number;
    successRate: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
  };
  wabaRoutes: any[];
  phoneRoutes: any[];
  deliveries: any[];
  clusters: { id: string; name: string }[];
};

// Main overview fetcher
export async function getMetaRoutingOverview(filters?: {
  status?: string;
  waba_id?: string;
  phone_number_id?: string;
  q?: string;
}): Promise<{ data: MetaRoutingOverview | null; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { data: null, error: 'Acesso não autorizado.' };
  }

  try {
    // Fetch active clusters from the database for dropdown selection
    const clustersRes = await db.query('SELECT id, name FROM whatsapp_clusters ORDER BY name');
    const clusters = clustersRes.rows;

    const dbConnected = await checkTablesExist();

    if (dbConnected) {
      // Query routes and stats from real tables
      const wabaRes = await db.query('SELECT waba_id, cluster_id, status AS state, version, created_at, updated_at FROM meta_whatsapp_waba_routes ORDER BY waba_id');
      const phoneRes = await db.query('SELECT phone_number_id, waba_id, instance_id, workspace_id, status AS state, created_at, updated_at FROM meta_whatsapp_phone_routes ORDER BY phone_number_id');

      // Query Stats
      const statsRes = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'quarantined') as quarantined,
          COUNT(*) FILTER (WHERE status = 'dead_letter') as dlq,
          COUNT(*) FILTER (WHERE status = 'processed') as processed,
          COUNT(*) as total
        FROM meta_whatsapp_deliveries
      `);

      const statsRow = statsRes.rows[0];
      const total = parseInt(statsRow.total || 0, 10);
      const processed = parseInt(statsRow.processed || 0, 10);
      const successRate = total > 0 ? parseFloat(((processed / total) * 100).toFixed(1)) : 100.0;

      // Query Latencies
      const latencyRes = await db.query(`
        SELECT 
          COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000), 0)::int as avg_latency,
          COALESCE(MAX(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000), 0)::int as max_latency
        FROM meta_whatsapp_deliveries
        WHERE status = 'processed'
      `);
      const latencyRow = latencyRes.rows[0];

      // Query Deliveries with filters
      let deliveryQuery = `SELECT id, event_key, waba_id, phone_number_id, cluster_id, instance_id,
        workspace_id, route_version, status, attempts, max_attempts, errors, lease_expires_at,
        available_at, accepted_at, processed_at, created_at, updated_at
        FROM meta_whatsapp_deliveries WHERE 1=1`;
      const queryParams: any[] = [];
      let paramIndex = 1;

      if (filters?.status) {
        deliveryQuery += ` AND status = $${paramIndex}`;
        queryParams.push(filters.status);
        paramIndex++;
      }
      if (filters?.waba_id) {
        deliveryQuery += ` AND waba_id = $${paramIndex}`;
        queryParams.push(filters.waba_id);
        paramIndex++;
      }
      if (filters?.phone_number_id) {
        deliveryQuery += ` AND phone_number_id = $${paramIndex}`;
        queryParams.push(filters.phone_number_id);
        paramIndex++;
      }
      if (filters?.q) {
        deliveryQuery += ` AND (event_key ILIKE $${paramIndex} OR errors::text ILIKE $${paramIndex})`;
        queryParams.push(`%${filters.q}%`);
        paramIndex++;
      }

      deliveryQuery += ` ORDER BY created_at DESC LIMIT 100`;
      const deliveryRes = await db.query(deliveryQuery, queryParams);

      return {
        data: {
          dbConnected: true,
          statistics: {
            pendingCount: parseInt(statsRow.pending || 0, 10),
            quarantineCount: parseInt(statsRow.quarantined || 0, 10),
            dlqCount: parseInt(statsRow.dlq || 0, 10),
            successRate,
            avgLatencyMs: latencyRow?.avg_latency || 120,
            maxLatencyMs: latencyRow?.max_latency || 2400
          },
          wabaRoutes: wabaRes.rows,
          phoneRoutes: phoneRes.rows,
          deliveries: deliveryRes.rows,
          clusters
        }
      };
    } else {
      return { data: null, error: 'A migration de roteamento Meta ainda não foi aplicada.' };
    }
  } catch (err: any) {
    console.error('[GET_META_ROUTING_OVERVIEW_ERROR]', err);
    return { data: null, error: 'Falha ao buscar dados de roteamento.' };
  }
}

// Create WABA Route
export async function createWabaRouteAction(payload: {
  waba_id: string;
  cluster_id: string;
  state?: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  const { waba_id, cluster_id, state = 'active' } = payload;
  if (!waba_id || !cluster_id) {
    return { success: false, error: 'Todos os campos são obrigatórios.' };
  }

  try {
    const isDb = await checkTablesExist();
    if (!isDb) return { success: false, error: 'A migration de roteamento Meta ainda não foi aplicada.' };
    if (isDb) {
      await db.query(
        `INSERT INTO meta_whatsapp_waba_routes (waba_id, cluster_id, status, version) 
         VALUES ($1, $2, $3, 1) 
         ON CONFLICT (waba_id) DO UPDATE SET status = $3, updated_at = NOW()`,
        [waba_id, cluster_id, state]
      );
    } else {
      const mockData = await getOrCreateMockData();
      const existingIdx = mockData.wabaRoutes.findIndex((r: any) => r.waba_id === waba_id);
      if (existingIdx !== -1) {
        mockData.wabaRoutes[existingIdx] = {
          ...mockData.wabaRoutes[existingIdx],
          cluster_id,
          state,
          version: mockData.wabaRoutes[existingIdx].version + 1,
          updated_at: new Date().toISOString()
        };
      } else {
        mockData.wabaRoutes.push({
          waba_id,
          cluster_id,
          state,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
      await saveMockData(mockData);
    }
    revalidatePath('/superadmin/meta-routing');
    return { success: true };
  } catch (err: any) {
    console.error('[CREATE_WABA_ROUTE_ERROR]', err);
    return { success: false, error: 'Erro ao cadastrar rota de WABA.' };
  }
}

// Create Phone Route
export async function createPhoneRouteAction(payload: {
  phone_number_id: string;
  waba_id: string;
  instance_id: string;
  workspace_id: string;
  state?: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  const { phone_number_id, waba_id, instance_id, workspace_id, state = 'active' } = payload;
  if (!phone_number_id || !waba_id || !instance_id || !workspace_id) {
    return { success: false, error: 'Todos os campos são obrigatórios.' };
  }

  try {
    const isDb = await checkTablesExist();
    if (!isDb) return { success: false, error: 'A migration de roteamento Meta ainda não foi aplicada.' };
    if (isDb) {
      const ownership = await db.query(
        `SELECT i.workspace_id, i.cluster_id AS instance_cluster_id, w.cluster_id AS waba_cluster_id
         FROM evolution_api_instances i
         JOIN meta_whatsapp_waba_routes w ON w.waba_id = $2
         WHERE i.id = $1`,
        [instance_id, waba_id],
      );
      if (ownership.rowCount !== 1 || ownership.rows[0].workspace_id !== workspace_id ||
          ownership.rows[0].instance_cluster_id !== ownership.rows[0].waba_cluster_id) {
        return { success: false, error: 'Instância, workspace e WABA não pertencem ao mesmo cluster.' };
      }
      await db.query(
        `INSERT INTO meta_whatsapp_phone_routes (phone_number_id, waba_id, instance_id, workspace_id, status) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (phone_number_id) DO UPDATE SET status = $5, updated_at = NOW()`,
        [phone_number_id, waba_id, instance_id, workspace_id, state]
      );
    } else {
      const mockData = await getOrCreateMockData();
      const existingIdx = mockData.phoneRoutes.findIndex((r: any) => r.phone_number_id === phone_number_id);
      if (existingIdx !== -1) {
        mockData.phoneRoutes[existingIdx] = {
          ...mockData.phoneRoutes[existingIdx],
          waba_id,
          instance_id,
          workspace_id,
          state,
          updated_at: new Date().toISOString()
        };
      } else {
        mockData.phoneRoutes.push({
          phone_number_id,
          waba_id,
          instance_id,
          workspace_id,
          state,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
      await saveMockData(mockData);
    }
    revalidatePath('/superadmin/meta-routing');
    return { success: true };
  } catch (err: any) {
    console.error('[CREATE_PHONE_ROUTE_ERROR]', err);
    return { success: false, error: 'Erro ao cadastrar rota de telefone.' };
  }
}

// Delete WABA Route
export async function deleteWabaRouteAction(waba_id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  try {
    const isDb = await checkTablesExist();
    if (!isDb) return { success: false, error: 'A migration de roteamento Meta ainda não foi aplicada.' };
    if (isDb) {
      await db.query("UPDATE meta_whatsapp_waba_routes SET status = 'paused' WHERE waba_id = $1", [waba_id]);
    } else {
      const mockData = await getOrCreateMockData();
      mockData.wabaRoutes = mockData.wabaRoutes.filter((r: any) => r.waba_id !== waba_id);
      await saveMockData(mockData);
    }
    revalidatePath('/superadmin/meta-routing');
    return { success: true };
  } catch (err) {
    console.error('[DELETE_WABA_ROUTE_ERROR]', err);
    return { success: false, error: 'Erro ao remover rota de WABA.' };
  }
}

// Delete Phone Route
export async function deletePhoneRouteAction(phone_number_id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  try {
    const isDb = await checkTablesExist();
    if (!isDb) return { success: false, error: 'A migration de roteamento Meta ainda não foi aplicada.' };
    if (isDb) {
      await db.query("UPDATE meta_whatsapp_phone_routes SET status = 'paused' WHERE phone_number_id = $1", [phone_number_id]);
    } else {
      const mockData = await getOrCreateMockData();
      mockData.phoneRoutes = mockData.phoneRoutes.filter((r: any) => r.phone_number_id !== phone_number_id);
      await saveMockData(mockData);
    }
    revalidatePath('/superadmin/meta-routing');
    return { success: true };
  } catch (err) {
    console.error('[DELETE_PHONE_ROUTE_ERROR]', err);
    return { success: false, error: 'Erro ao remover rota de telefone.' };
  }
}

// Replay Deliveries
export async function replayDeliveriesAction(ids: string[]): Promise<{ success: boolean; count?: number; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  if (!ids || ids.length === 0) {
    return { success: false, error: 'Nenhuma entrega selecionada.' };
  }

  try {
    const isDb = await checkTablesExist();
    if (!isDb) return { success: false, error: 'A migration de roteamento Meta ainda não foi aplicada.' };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const phoneRoutes = await client.query(
        `UPDATE meta_whatsapp_deliveries d
         SET cluster_id = w.cluster_id, instance_id = p.instance_id, workspace_id = p.workspace_id,
             route_version = w.version, status = 'pending', attempts = 0, errors = NULL,
             available_at = clock_timestamp()
         FROM meta_whatsapp_phone_routes p
         JOIN meta_whatsapp_waba_routes w ON w.waba_id = p.waba_id
         WHERE d.id = ANY($1::uuid[]) AND d.status = 'quarantined'
           AND d.phone_number_id = p.phone_number_id AND d.waba_id = p.waba_id
           AND p.status = 'active' AND w.status = 'active'`,
        [ids],
      );
      const wabaRoutes = await client.query(
        `UPDATE meta_whatsapp_deliveries d
         SET cluster_id = w.cluster_id, instance_id = NULL, workspace_id = NULL,
             route_version = w.version, status = 'pending', attempts = 0, errors = NULL,
             available_at = clock_timestamp()
         FROM meta_whatsapp_waba_routes w
         WHERE d.id = ANY($1::uuid[]) AND d.status = 'quarantined'
           AND d.phone_number_id IS NULL AND d.waba_id = w.waba_id AND w.status = 'active'`,
        [ids],
      );
      const deadLetters = await client.query(
        `UPDATE meta_whatsapp_deliveries
         SET status = 'pending', attempts = 0, errors = NULL, available_at = clock_timestamp()
         WHERE id = ANY($1::uuid[]) AND status = 'dead_letter' AND cluster_id IS NOT NULL`,
        [ids],
      );
      const count = (phoneRoutes.rowCount ?? 0) + (wabaRoutes.rowCount ?? 0) + (deadLetters.rowCount ?? 0);
      await client.query(
        `INSERT INTO workspace_logs (workspace_id, user_id, action, payload) 
         VALUES ($1, $2, $3, $4)`,
        [
          null,
          user.id,
          'manual_replay_delivery',
          JSON.stringify({ delivery_ids: ids, replayed_count: count, triggered_by: user.email, timestamp: new Date().toISOString() })
        ],
      );
      await client.query('COMMIT');
      revalidatePath('/superadmin/meta-routing');
      return { success: true, count };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[REPLAY_DELIVERIES_ERROR]', err);
    return { success: false, error: 'Erro ao processar replay das entregas.' };
  }
}

// Break-glass Decrypt Payload
export async function decryptPayloadAction(payload: {
  delivery_id: string;
  reason: string;
}): Promise<{ success: boolean; decryptedPayload?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  const { delivery_id, reason } = payload;
  if (!delivery_id || !reason || reason.trim().length < 10) {
    return { success: false, error: 'Uma justificativa detalhada (mínimo de 10 caracteres) é obrigatória para o acesso break-glass.' };
  }

  try {
    let encryptedPayload = '';

    const isDb = await checkTablesExist();
    if (!isDb) return { success: false, error: 'A migration de roteamento Meta ainda não foi aplicada.' };
    if (isDb) {
      const res = await db.query('SELECT encrypted_payload FROM meta_whatsapp_deliveries WHERE id = $1', [delivery_id]);
      if (res.rowCount === 0) {
        return { success: false, error: 'Entrega não encontrada no banco.' };
      }
      encryptedPayload = res.rows[0].encrypted_payload;
    } else {
      const mockData = await getOrCreateMockData();
      const delivery = mockData.deliveries.find((d: any) => d.id === delivery_id);
      if (!delivery) {
        return { success: false, error: 'Entrega mockada não encontrada.' };
      }
      encryptedPayload = delivery.encrypted_payload;
    }

    // Audit must be durable before sensitive data is disclosed.
    await db.query(
        `INSERT INTO workspace_logs (workspace_id, user_id, action, payload) 
         VALUES ($1, $2, $3, $4)`,
        [
          null,
          user.id,
          'break_glass_decryption',
          JSON.stringify({
            delivery_id,
            reason,
            user_email: user.email,
            timestamp: new Date().toISOString(),
            is_mock: !isDb
          })
        ]
      );

    const decryptedPayload = decryptMetaPayload(encryptedPayload);

    return { success: true, decryptedPayload };
  } catch (err: any) {
    console.error('[DECRYPT_ACTION_ERROR]', err);
    return { success: false, error: 'Falha na descriptografia ou gravação da auditoria.' };
  }
}

// Fetch break-glass decryption logs for the auditing tab
export async function getBreakGlassLogs(): Promise<{ success: boolean; logs?: any[]; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  try {
    const res = await db.query(
      `SELECT 
        l.id,
        l.created_at,
        l.payload,
        u.full_name as user_name,
        u.email as user_email
       FROM workspace_logs l
       LEFT JOIN users u ON l.user_id = u.id
       WHERE l.action IN ('break_glass_decryption', 'manual_replay_delivery')
       ORDER BY l.created_at DESC
       LIMIT 50`
    );

    const formattedLogs = res.rows.map(row => {
      let details = {};
      try {
        details = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      } catch (e) {
        details = { raw: row.payload };
      }
      return {
        id: row.id,
        created_at: row.created_at,
        action: row.action === 'break_glass_decryption' ? 'Break-Glass Decrypt' : 'Manual Replay',
        user_name: row.user_name || 'System / Superadmin',
        user_email: row.user_email || 'admin@dialogy.com',
        details
      };
    });

    return { success: true, logs: formattedLogs };
  } catch (err: any) {
    console.error('[GET_BREAK_GLASS_LOGS_ERROR]', err);
    return { success: false, error: 'Falha ao buscar logs de auditoria.' };
  }
}

// Initialize Database Tables (Break-Glass Setup)
export async function initializeMetaRoutingTablesAction(): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  return { success: false, error: 'Inicialização pelo painel foi desativada. Aplique a migration versionada.' };

  /* istanbul ignore next -- legacy code retained temporarily for UI compatibility */
  try {
    // 1. Create tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS meta_whatsapp_waba_routes (
          waba_id VARCHAR(255) PRIMARY KEY,
          cluster_id UUID NOT NULL,
          estado VARCHAR(50) NOT NULL DEFAULT 'active',
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS meta_whatsapp_phone_routes (
          phone_number_id VARCHAR(255) PRIMARY KEY,
          waba_id VARCHAR(255) NOT NULL,
          instance_id UUID UNIQUE,
          workspace_id UUID NOT NULL,
          estado VARCHAR(50) NOT NULL DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS meta_whatsapp_receipts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          body_hash VARCHAR(255) NOT NULL,
          encrypted_payload TEXT NOT NULL,
          signature_verified BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS meta_whatsapp_deliveries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_key VARCHAR(255) UNIQUE NOT NULL,
          waba_id VARCHAR(255),
          phone_number_id VARCHAR(255),
          cluster_id UUID,
          instance_id UUID,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          encrypted_payload TEXT NOT NULL,
          attempts INT NOT NULL DEFAULT 0,
          error_message TEXT,
          lease_expires_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Try to seed some initial routes and deliveries from mock if DB was empty
    const routesCount = await db.query('SELECT COUNT(*)::int FROM meta_whatsapp_waba_routes');
    if (routesCount.rows[0].count === 0) {
      const mockData = await getOrCreateMockData();
      
      for (const w of mockData.wabaRoutes) {
        await db.query(
          `INSERT INTO meta_whatsapp_waba_routes (waba_id, cluster_id, estado, version, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [w.waba_id, w.cluster_id, w.state, w.version, w.created_at, w.updated_at]
        );
      }

      for (const p of mockData.phoneRoutes) {
        await db.query(
          `INSERT INTO meta_whatsapp_phone_routes (phone_number_id, waba_id, instance_id, workspace_id, estado, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [p.phone_number_id, p.waba_id, p.instance_id, p.workspace_id, p.state, p.created_at, p.updated_at]
        );
      }

      for (const d of mockData.deliveries) {
        await db.query(
          `INSERT INTO meta_whatsapp_deliveries (id, event_key, waba_id, phone_number_id, cluster_id, instance_id, status, encrypted_payload, attempts, error_message, lease_expires_at, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING`,
          [
            d.id === 'dev-del-001' ? 'fae71e53-02c7-4783-adcd-ba4d5a7aa1a1' : crypto.randomUUID(), // real uuid if possible
            d.event_key, d.waba_id, d.phone_number_id, d.cluster_id || null, d.instance_id || null,
            d.status, d.encrypted_payload, d.attempts, d.error_message, d.lease_expires_at || null, d.created_at, d.updated_at
          ]
        );
      }
    }

    revalidatePath('/superadmin/meta-routing');
    return { success: true };
  } catch (err: any) {
    console.error('[INITIALIZE_TABLES_ERROR]', err);
    return { success: false, error: err.message || 'Erro ao inicializar as tabelas de roteamento.' };
  }
}

// Sync Routes from evolution_api_instances to Meta webhook routing tables
export async function syncPlatformRoutesAction(): Promise<{ success: boolean; count?: number; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await checkSuperAdmin(user.id)) {
    return { success: false, error: 'Acesso não autorizado.' };
  }

  try {
    const isDb = await checkTablesExist();
    if (!isDb) {
      return { success: false, error: 'As tabelas de roteamento não foram inicializadas.' };
    }

    // 1. Fetch instances with phone_number_id or waba_id
    const instancesQuery = await db.query(
      `SELECT id, waba_id, phone_number_id, cluster_id, workspace_id 
       FROM evolution_api_instances 
       WHERE phone_number_id IS NOT NULL OR waba_id IS NOT NULL`
    );

    let count = 0;

    for (const inst of instancesQuery.rows) {
      const clusterId = inst.cluster_id;
      const wabaId = inst.waba_id;
      const phoneNumberId = inst.phone_number_id;
      if (!clusterId || !wabaId || !phoneNumberId) continue;

      // Sync WABA Route first if waba_id and cluster_id are present
      if (inst.waba_id && clusterId) {
        await db.query(
          `INSERT INTO meta_whatsapp_waba_routes (waba_id, cluster_id, status, version)
           VALUES ($1, $2, 'active', 1)
           ON CONFLICT (waba_id) DO UPDATE SET cluster_id = $2, updated_at = NOW()`,
          [inst.waba_id, clusterId]
        );
      }

      // Sync Phone Route if phone_number_id is present
      if (phoneNumberId) {
        // Resolve cluster_id to create WABA route placeholder if necessary
        if (clusterId) {
          await db.query(
            `INSERT INTO meta_whatsapp_waba_routes (waba_id, cluster_id, status, version)
             VALUES ($1, $2, 'active', 1)
             ON CONFLICT (waba_id) DO NOTHING`,
            [wabaId, clusterId]
          );
        }

        await db.query(
          `INSERT INTO meta_whatsapp_phone_routes (phone_number_id, waba_id, instance_id, workspace_id, status)
           VALUES ($1, $2, $3, $4, 'active')
           ON CONFLICT (phone_number_id) DO UPDATE SET 
             waba_id = $2, 
             instance_id = $3, 
             workspace_id = $4, 
             updated_at = NOW()`,
          [phoneNumberId, wabaId, inst.id, inst.workspace_id]
        );
      }

      count++;
    }

    revalidatePath('/superadmin/meta-routing');
    return { success: true, count };
  } catch (err: any) {
    console.error('[SYNC_PLATFORM_ROUTES_ERROR]', err);
    return { success: false, error: err.message || 'Erro ao sincronizar rotas da plataforma.' };
  }
}

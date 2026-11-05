import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { planStudioMigration } from '../src/services/agent-studio/migration';
import { createStudioSgpMultiProcedure } from '../src/services/agent-studio/sgp-template';
import { validateAgentForPublication } from '../src/services/agent-studio/assistant-validator';

const agentId = '23749803-7d16-404b-bc91-2ba2393c0358';
const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT a.*, w.name AS workspace_name FROM autopilot_configs a JOIN workspaces w ON w.id=a.workspace_id WHERE a.id=$1 AND a.workspace_id=$2 FOR UPDATE OF a`, [agentId, workspaceId])).rows[0];
    if (!row || row.name !== 'Financeiro Sofia' || !/velpro/i.test(row.workspace_name)) throw new Error('Agente ou workspace não corresponde à Sofia da Velpro.');
    const draft = await client.query('SELECT 1 FROM autopilot_config_drafts WHERE config_id=$1 AND workspace_id=$2', [agentId, workspaceId]);
    if (draft.rowCount) throw new Error('Já existe um rascunho; ele foi preservado.');
    const team = await client.query('SELECT id FROM teams WHERE workspace_id=$1 AND lower(name)=$2', [workspaceId, 'financeiro']);
    if (team.rowCount !== 1) throw new Error('Equipe financeira não identificada de forma única.');
    const integration = await client.query("SELECT 1 FROM workspace_integrations WHERE workspace_id=$1 AND provider='sgp' AND is_active=true AND COALESCE(config->>'baseUrl','') <> '' AND COALESCE(config->>'cpfFieldId','') <> ''", [workspaceId]);
    if (!integration.rowCount) throw new Error('Integração SGP não está configurada para consulta por CPF.');
    const migration = planStudioMigration(row);
    const document = migration.document;
    document.draftRevision = 1;
    document.aiModel = 'deepseek/deepseek-v4-flash';
    document.objective = 'Ajudar clientes da Velpro com faturas, pagamentos e dúvidas financeiras de todos os seus contratos, usando dados confirmados no SGP e mantendo cada pedido e instalação identificados.';
    document.rules.toneOfVoice = 'Acolhedor, claro, profissional e objetivo. Nunca constranja o cliente por pagamentos ou débitos.';
    document.rules.prohibitedDataLabels = ['senha', 'token', 'código de autenticação'];
    document.understandStage.welcomeMessage = 'Olá! Sou a Sofia, assistente financeira da Velpro. Como posso ajudar você hoje?';
    document.concludeStage.handoffTeam = String(team.rows[0].id);
    document.concludeStage.handoffMessage = 'Vou encaminhar seu atendimento à equipe financeira com o contexto do que já verificamos.';
    document.concludeStage.confirmResolutionQuestion = 'Consegui ajudar com tudo o que você precisava?';
    document.concludeStage.successClosingMessage = 'Obrigada pelo contato! Quando precisar, pode chamar a gente por aqui.';
    document.resolveStage.conversationMode = 'adaptive';
    document.resolveStage.reasoning = { enabled: true, effort: 'high', supportModel: null, maxDecisions: 12, maxTurnMs: 90000 };
    document.resolveStage.procedures = [createStudioSgpMultiProcedure(`sofia_sgp_${randomUUID().replaceAll('-', '')}`)];
    document.inlineKnowledge = [{ id: randomUUID(), name: 'Orientações financeiras Sofia', content: `A Sofia é assistente virtual financeira da Velpro. Atenda em português, com empatia, sem constranger o cliente. Separe solicitações simultâneas e instalações. Consulte o SGP antes de afirmar status, valor, vencimento, baixa, plano ou conexão. Use os dados e links retornados para o contrato correto. Se o cliente pedir duas faturas de cada contrato, entregue duas por contrato; se a quantidade for ambígua, esclareça. Não prometa que uma fatura foi enviada quando só houver um link. CPF identifica um cadastro e não prova identidade. Não solicite senhas, códigos de autenticação ou dados de cartão. Comprovante recebido não confirma pagamento; encaminhe ao financeiro para análise. Não prometa desbloqueio, negociação, desconto, prazo, baixa ou promessa de pagamento sem ferramenta autorizada e confirmação real. Quando não houver capacidade ou o sistema falhar, informe a limitação e encaminhe para a equipe Financeiro. Não encerre enquanto houver solicitação pendente; respeite pedido claro de atendimento humano.` }];
    const validation = validateAgentForPublication(document);
    if (!validation.valid) throw new Error(`Validação do rascunho falhou: ${JSON.stringify(validation.issues)}`);
    await mkdir('artifacts/agents', { recursive: true });
    await writeFile('artifacts/agents/sofia-financeiro-studio.json', JSON.stringify(document, null, 2), 'utf8');
    if (process.argv.includes('--save-draft')) {
      const snapshot = { name: row.name, ai_model: document.aiModel, is_active: row.is_active, is_private: row.is_private, agent_studio_document: document, agent_studio_legacy_backup: migration.backup };
      await client.query('INSERT INTO autopilot_config_drafts(config_id,workspace_id,user_id,snapshot,updated_at) VALUES($1,$2,$3,$4::jsonb,now())', [agentId, workspaceId, row.user_id, JSON.stringify(snapshot)]);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ agent: row.name, valid: validation.valid, draftSaved: process.argv.includes('--save-draft'), published: false, migrationReview: migration.report.items.filter((item) => item.status === 'review').map((item) => item.title), artifact: 'artifacts/agents/sofia-financeiro-studio.json' }));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

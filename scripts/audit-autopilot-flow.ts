import 'dotenv/config';

import { Pool } from 'pg';

import type { AutopilotConfig, KnowledgeBaseDocument } from '../src/lib/types';
import { resolveAutopilotIntent } from '../src/services/autopilot-intent';
import {
  filterKnowledgeDocumentsForScope,
  resolveActiveFlowIntentScope,
  resolveEntryDeterministicFlowMessage,
} from '../src/services/autopilot/flow-routing';
import { compileAutopilotTurnPolicy } from '../src/services/autopilot/turn-policy';

const configId = process.argv[2];
if (!configId) {
  throw new Error('Uso: npx tsx scripts/audit-autopilot-flow.ts <autopilot-config-id>');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function parseJson<T>(value: T | string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function printFinding(severity: 'CRITICO' | 'ALTO' | 'MEDIO', message: string) {
  console.log(`[${severity}] ${message}`);
}

async function main() {
  const result = await pool.query(
    `SELECT *
       FROM public.autopilot_configs
      WHERE id = $1
      LIMIT 1`,
    [configId],
  );
  if (!result.rows[0]) throw new Error(`Agente ${configId} nao encontrado.`);

  const config = {
    ...result.rows[0],
    flow_graph: parseJson(result.rows[0].flow_graph, null),
    knowledge_base_documents: parseJson<KnowledgeBaseDocument[]>(result.rows[0].knowledge_base_documents, []),
    enabled_tool_names: parseJson<string[]>(result.rows[0].enabled_tool_names, []),
  } as AutopilotConfig;
  const documents = config.knowledge_base_documents || [];
  const graph = config.flow_graph;
  if (!graph) throw new Error('Agente sem flow_graph publicado.');

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const intentNodes = graph.nodes.filter((node) => node.kind === 'intent');
  const knowledgeNodes = graph.nodes.filter((node) => node.kind === 'knowledge');
  const toolNodes = graph.nodes.filter((node) => node.kind === 'tool');
  const principalAssistant = graph.nodes.find((node) => node.kind === 'assistant');
  const findings: Array<{ severity: 'CRITICO' | 'ALTO' | 'MEDIO'; message: string }> = [];
  const add = (severity: 'CRITICO' | 'ALTO' | 'MEDIO', message: string) => findings.push({ severity, message });

  console.log(`\nAUDITORIA DO FLOW: ${config.name} (${config.id})`);
  console.log(`Blocos: ${graph.nodes.length} | Arestas: ${graph.edges.length} | Docs RAG: ${documents.length}`);
  console.log(`Tools globais habilitadas: ${(config.enabled_tool_names || []).join(', ') || '(nenhuma)'}`);

  const duplicateIntentGroups = new Map<string, string[]>();
  for (const node of intentNodes) {
    const intent = node.config?.intent || '(sem intent)';
    duplicateIntentGroups.set(intent, [...(duplicateIntentGroups.get(intent) || []), node.id]);
  }
  for (const [intent, ids] of duplicateIntentGroups) {
    if (ids.length > 1) {
      add('CRITICO', `Intent duplicada "${intent}" em ${ids.join(', ')}. O runtime usa o primeiro match e os seguintes ficam inalcançaveis.`);
    }
  }

  if (toolNodes.length === 0 && (config.enabled_tool_names || []).length > 0) {
    add('CRITICO', 'Existem tools globais habilitadas, mas nenhum bloco tool conectado no flow. A TurnPolicy aplica default deny e nenhuma tool pode executar.');
  }

  const principalToolNames = new Set(
    graph.edges
      .filter((edge) => principalAssistant && edge.source === principalAssistant.id)
      .map((edge) => toolNodes.find((tool) => tool.id === edge.target)?.toolName)
      .filter((toolName): toolName is string => Boolean(toolName)),
  );
  const hasPrincipalKnowledge = principalAssistant
    ? graph.edges.some((edge) => edge.target === principalAssistant.id && knowledgeNodes.some((knowledge) => knowledge.id === edge.source))
    : false;

  for (const node of intentNodes) {
    const hasOwnKnowledge = graph.edges.some((edge) => (
      edge.target === node.id && knowledgeNodes.some((knowledge) => knowledge.id === edge.source)
    ));
    if (!hasPrincipalKnowledge && !hasOwnKnowledge) {
      add('ALTO', `Sub-agente ${node.id} (${node.title}) nao possui knowledge proprio nem herdado do assistant principal. Quando ativado, o RAG fica sem documentos permitidos.`);
    }
    if (node.config?.message?.trim()) {
      add('ALTO', `Mensagem configurada diretamente no sub-agente ${node.id} nao e enviada pelo runtime. Use um bloco send_message ou form conectado.`);
    }
  }

  if ((config.enabled_tool_names || []).length > 0 && toolNodes.length > 0 && principalToolNames.size === 0) {
    add('ALTO', 'Ha blocos tool, mas nenhuma tool esta conectada ao assistant principal. Sub-agentes so herdam ferramentas ligadas ao principal ou ligadas diretamente a eles.');
  }

  for (const node of graph.nodes) {
    if (node.kind === 'assistant' && node.config?.message?.trim()) {
      add('ALTO', `Mensagem configurada diretamente no assistant ${node.id} nao e enviada pelo runtime. Use send_message ou form.`);
    }
    if (node.kind === 'trigger' && graph.edges.some((edge) => edge.target === node.id)) {
      add('MEDIO', `Trigger ${node.id} recebe aresta de entrada. Trigger representa entrada; como encerramento visual ele nao executa close_chat.`);
    }
  }

  const ordinaryChainEdges = graph.edges.filter((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    return source && target
      && source.kind !== 'knowledge'
      && target.kind !== 'tool'
      && target.kind !== 'rule'
      && !(source.kind === 'trigger' && target.kind === 'send_message');
  });
  if (ordinaryChainEdges.length > 0) {
    add('ALTO', `Ha ${ordinaryChainEdges.length} aresta(s) sequenciais visuais que nao avancam estado automaticamente. O runtime escolhe sub-agente por intent classificada, nao pela proxima aresta.`);
  }

  const entryMessage = resolveEntryDeterministicFlowMessage(config);
  console.log(`\nEntrada deterministica: ${entryMessage ? `${entryMessage.nodeId} -> "${entryMessage.message}"` : '(nenhuma)'}`);

  const scenarios = [
    'Ola',
    'Quero contratar um plano de internet',
    'Quero o plano de 1000 MEGA',
    'Meu nome e Fabricio',
    'Moro no Ocidental Park',
    'Meu CPF e 52998224725',
    'Pode continuar',
  ];

  console.log('\nSIMULACAO PURA DO RUNTIME');
  for (const message of scenarios) {
    const resolution = resolveAutopilotIntent({
      customerMessage: message,
      chatHistory: '',
      knowledgeDocuments: documents,
    });
    const scope = resolveActiveFlowIntentScope(config, resolution.intent);
    const scopedDocs = filterKnowledgeDocumentsForScope(config, documents, scope);
    const policy = compileAutopilotTurnPolicy({
      config,
      documents,
      intentScope: scope,
    });
    console.log(`- "${message}"`);
    console.log(`  intent=${resolution.intent} | node=${policy.activeNodeId || '(nenhum)'} | subAgent=${scope?.title || '(principal)'}`);
    console.log(`  ragDocs=${scopedDocs.length} | tools=${policy.allowedToolNames.join(', ') || '(nenhuma)'} | policy=${policy.reason}`);
  }

  console.log('\nACHADOS');
  for (const finding of findings) printFinding(finding.severity, finding.message);
  console.log(`\nTotal: ${findings.length} achado(s). Auditoria somente leitura; nenhum dado foi alterado.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

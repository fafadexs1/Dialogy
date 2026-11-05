import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';
import { advanceStudioSession, createStudioSession, type StudioEngineDependencies, type StudioSession } from '../src/services/agent-studio/engine';
import type { AgentStudioDocument } from '../src/services/agent-studio/types';
import { interpretStudioTurn } from '../src/services/agent-studio/turn-interpreter';
import { interpretStudioCollection } from '../src/services/agent-studio/collection-interpreter';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function getVelproData() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const wsId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';

  // 1. DeepSeek key
  const rowInteg = await client.query(
    "SELECT config FROM workspace_integrations WHERE workspace_id = $1 AND provider = 'deepseek'",
    [wsId]
  );
  const deepseekCfg = typeof rowInteg.rows[0].config === 'string' ? JSON.parse(rowInteg.rows[0].config) : rowInteg.rows[0].config;
  const apiKey = deepseekCfg.apiKey;
  const model = deepseekCfg.aiModel?.replace('deepseek/', '') || 'deepseek-flash';

  // 2. Latest document for Raquel
  const rowVer = await client.query(
    "SELECT snapshot FROM autopilot_config_versions WHERE config_id = '0a952e14-2fdc-47eb-99d6-733a2d4868a5' ORDER BY version_number DESC LIMIT 1"
  );
  const doc = rowVer.rows[0].snapshot.agent_studio_document as AgentStudioDocument;

  await client.end();
  return { apiKey, model, doc, wsId };
}

async function callDeepSeekDecision(
  apiKey: string,
  model: string,
  prompt: string,
  choices: { id: string; label: string }[],
  contextLabel = 'decision'
): Promise<string | null> {
  const systemInstruction = `Você é o classificador semântico e motor de raciocínio da IA de atendimento Dialogy.
Analise a instrução, o objetivo comercial e o estado estruturado da conversa.
Escolha EXATAMENTE UM dos identificadores permitidos na lista de opções.

Opções permitidas:
${choices.map(c => `- ID: "${c.id}" -> ${c.label}`).join('\n')}

Responda EXCLUSIVAMENTE em formato JSON com o campo "decision":
{"decision": "<id_escolhido>"}`;

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'deepseek-flash',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[DeepSeek HTTP ${response.status}]`, errText);
    return null;
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(rawContent);
    const decision = parsed.decision || parsed.id || parsed.choice;
    if (choices.some(c => c.id === decision)) {
      return decision;
    }
    const matched = choices.find(c => decision === c.id || rawContent.includes(`"${c.id}"`));
    if (matched) return matched.id;
    console.log(`[DeepSeek ${contextLabel} unmapped]`, rawContent, 'available:', choices.map(c => c.id));
    return choices[0]?.id || null;
  } catch (e) {
    console.error(`[DeepSeek ${contextLabel} parse error]`, e, 'raw:', rawContent);
    const matched = choices.find(c => rawContent.includes(`"${c.id}"`));
    return matched ? matched.id : choices[0]?.id || null;
  }
}

function createDependencies(apiKey: string, model: string, doc: AgentStudioDocument): StudioEngineDependencies {
  return {
    chooseProcedure: async (procedures, message) => {
      const choices = [
        ...procedures.map(p => ({ id: p.id, label: p.name })),
        { id: 'none', label: 'Nenhum procedimento adequado' },
      ];
      const prompt = `Escolha o procedimento adequado para a mensagem: "${message}".\nProcedimentos:\n` +
        procedures.map(p => `- ${p.id}: ${p.name} (${p.description || ''}) - Exemplos: ${(p.exampleRequests || []).join(', ')}`).join('\n');
      const decision = await callDeepSeekDecision(apiKey, model, prompt, choices, 'chooseProcedure');
      return decision || 'none';
    },

    interpretTurn: async (turnInput) => {
      return interpretStudioTurn(turnInput, async (prompt, choices) => {
        const id = await callDeepSeekDecision(apiKey, model, prompt, choices, 'interpretTurn');
        return id;
      });
    },

    knowledge: async () => null,

    interpretCollection: async (collectionInput) => {
      return interpretStudioCollection(collectionInput, async (prompt, choices) => {
        return callDeepSeekDecision(apiKey, model, prompt, choices, 'interpretCollection');
      });
    },

    classifyControl: async ({ message, procedure, pendingField }) => {
      const choices = [
        { id: 'answer', label: 'Responder à etapa atual' },
        { id: 'cancel_procedure', label: 'Parar o procedimento atual' },
        { id: 'skip_field', label: 'Pular somente esta pergunta' },
        { id: 'change_intent', label: 'Mudar de solicitação' },
        { id: 'request_human', label: 'Falar com uma pessoa' },
      ];
      const prompt = `Classifique o controle explícito para a mensagem: "${message}". Procedimento ativo: ${procedure.name}. Campo: ${pendingField?.name || 'nenhum'}.`;
      const decision = await callDeepSeekDecision(apiKey, model, prompt, choices, 'classifyControl');
      return (decision || 'answer') as any;
    },

    execute: async (step, context, operation) => {
      console.log(`    ⚙️ [EXECUTE STEP] ${step.title} (${step.type})`);
      return { values: {} };
    },

    handoff: async (reason) => {
      console.log(`    🤝 [HANDOFF] Transferido para equipe comercial. Motivo: ${reason}`);
    },

    checkpoint: async (state) => {
      // noop in simulation
    },
  };
}

async function runConversation(
  title: string,
  doc: AgentStudioDocument,
  deps: StudioEngineDependencies,
  contact: { name?: string; phone?: string },
  messages: string[]
) {
  console.log(`\n======================================================================`);
  console.log(`SIMULAÇÃO: ${title}`);
  console.log(`Contato: ${contact.name || 'Sem nome'} | Tel: ${contact.phone || 'Sem telefone'}`);
  console.log(`======================================================================\n`);

  let state: StudioSession = createStudioSession(doc.id, 'release-velpro-live', `sim-${Date.now()}`);
  let turnNumber = 1;

  for (const userMsg of messages) {
    console.log(`👉 [Turno ${turnNumber}] Cliente: "${userMsg}"`);

    const result = await advanceStudioSession({
      document: doc,
      state,
      message: userMsg,
      messageId: `msg-${turnNumber}`,
      context: { contact, input: {} },
      dependencies: deps,
    });

    state = result.state;

    console.log(`🤖 [Turno ${turnNumber}] Raquel (Assistente):`);
    console.log(result.response ? result.response.split('\n').map(l => `   ${l}`).join('\n') : '   [SILÊNCIO]');
    console.log(`📊 Estado Interno:`);
    console.log(`   - Fase: ${state.phase} | Status: ${state.status} | Procedimento: ${state.procedureId}`);
    console.log(`   - StepIndex: ${state.stepIndex} | PendingField: ${state.pendingField || 'nenhum'}`);
    console.log(`   - Confirmação Pendente: ${state.confirmation ? JSON.stringify(state.confirmation.key) : 'nenhuma'}`);
    console.log(`   - Proposta de Opção: ${state.collectionProposal ? JSON.stringify(state.collectionProposal.label) : 'nenhuma'}`);
    console.log(`   - Dados Coletados: ${JSON.stringify(state.values)}`);
    console.log(`----------------------------------------------------------------------\n`);

    turnNumber++;
  }

  return state;
}

async function main() {
  console.log('Iniciando ambiente de simulação com IA DeepSeek real da Velpro Telecom...');
  const { apiKey, model, doc } = await getVelproData();
  console.log(`Modelo DeepSeek ativo: ${model} | API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log(`Agente: ${doc.name} (${doc.id})`);

  const deps = createDependencies(apiKey, model, doc);

  // CONVERSA 1: Caso real do Fabrício (Chat c8723344-3789-4d87-a27e-724e717f4a90)
  await runConversation(
    '1. Caso Real do Fabrício (1000 Mega, "É o mesmo...", CEP único sem repetição)',
    doc,
    deps,
    { name: 'Fabricio', phone: '5561995215930' },
    [
      'Quero contratar internet',
      '1000 mega',
      'É o mesmo que estou falando contigo',
      '72883772',
      'Rua 15, Quadra 40, Lote 12, Jardim Céu Azul',
      'tarde',
      'sim',
    ]
  );

  // CONVERSA 2: Correção de telefone após ter fornecido o CEP (teste de não apagamento downstream)
  await runConversation(
    '2. Correção de Telefone após CEP coletado (Verificação de Preservação Downstream)',
    doc,
    deps,
    { name: 'Carlos Eduardo', phone: '5561988887777' },
    [
      'Quero assinar internet',
      '500 mega',
      'sim',
      '72883772',
      'Quero corrigir o telefone',
      '61977778888',
      'sim',
      'Rua das Flores, 123, Centro',
      'qualquer horário',
      'sim',
    ]
  );

  // CONVERSA 3: Dúvida sobre o plano antes de fechar + referência ao canal
  await runConversation(
    '3. Cliente com Dúvida antes de Escolher + Referência ao Telefone Atual ("pode ser esse meu número")',
    doc,
    deps,
    { name: 'Mariana Lima', phone: '5561912345678' },
    [
      'Gostaria de fechar um plano de internet',
      'O plano de 600 mega tem fidelidade?',
      'Entendi, vou querer o de 600 mega mesmo',
      'sim',
      'pode ser esse meu número daqui mesmo',
      '72000000',
      'Av Central, bloco B, apt 302, Taguatinga',
      'manhã',
      'sim',
    ]
  );

  // CONVERSA 4: 800 MEGA com confirmação contextual do WhatsApp ("usa esse telefone aqui do zap")
  await runConversation(
    '4. 800 MEGA + Confirmação Contextual ("usa esse telefone aqui do zap")',
    doc,
    deps,
    { name: 'Juliana Costa', phone: '5561991112233' },
    [
      'Olá, quero contratar internet',
      '800 mega',
      'usa esse telefone aqui do zap',
      '72881234',
      'Quadra 10 conjunto 4 casa 18, Valparaíso',
      'noite',
      'com certeza, pode mandar pro comercial',
    ]
  );

  // CONVERSA 5: Expressões coloquiais brasileiras ("o mais top de 1000 mega", "positivo", etc.)
  await runConversation(
    '5. Expressões Coloquiais Brasileiras ("o mais top de 1000 mega", "positivo")',
    doc,
    deps,
    { name: 'Roberto Santos', phone: '5561984445566' },
    [
      'opa, quero colocar internet',
      'o mais top de 1000 mega',
      'positivo',
      'é esse mesmo',
      '72880000',
      'Rua São Paulo, lote 22, Novo Gama',
      'qualquer hora',
      'com certeza',
      'positivo',
    ]
  );

  console.log('\n======================================================================');
  console.log('✅ TODAS AS 5 SIMULAÇÕES COM DEEPSEEK FORAM CONCLUÍDAS!');
  console.log('======================================================================\n');
}

main().catch(console.error);

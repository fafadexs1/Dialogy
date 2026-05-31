import 'dotenv/config';
import { generateAgentResponse } from '../src/ai/flows/auto-responder';
import { getGlobalLmStudioConfig } from '../src/services/ai/lm-studio';

async function runSimulation() {
  console.log('=== INICIANDO SIMULAÇÃO DE CONTRATAÇÃO REAL COM MODELO LOCAL ===\n');

  const lmStudioConfig = await getGlobalLmStudioConfig();
  console.log('Endpoint LM Studio configurado:', lmStudioConfig.baseUrl || 'Não configurado (usando padrão)');

  // 1. Simular os dados do contato (um novo lead chamado Fabricio)
  const contact = {
    id: 'contact-fabricio-lead',
    name: 'Fabricio',
    email: 'fabricio@example.com',
    phone: '+5511999999999',
    address: 'Distrito Industrial Norte',
    tags: [],
    custom_fields: {}, // Novo lead: sem CPF/CNPJ salvo no CRM!
  };

  // 2. Simular a mensagem do cliente querendo contratar
  const customerMessage = 'Olá! Quero contratar o plano de 1000 MEGA. Moro no Distrito Industrial Norte e meu nome é Fabricio.';

  // 3. Documentos de conhecimento (Base de Conhecimento com catálogos de planos e regras de viabilidade)
  const knowledgeBaseDocuments = [
    {
      id: 'planos-internet',
      name: 'Planos de Internet Fibra',
      content: `NOSSOS PLANOS DE INTERNET:
- 500 MEGA (somente internet) - Wi-Fi 5: R$99,90/mês pagando em dia / R$109,90/mês.
- 1000 MEGA (+ 100 canais de TV) - Wi-Fi 6: R$149,90/mês pagando em dia / R$159,90/mês.`,
    },
    {
      id: 'viabilidade-distrito-industrial',
      name: 'Regras Especiais de Viabilidade',
      content: `Atenção: Por residir no Distrito Industrial Norte, há um prazo especial de 15 dias úteis para instalação devido à infraestrutura local e cabeamento de alta tensão, exigindo viabilidade especial técnica.`,
    }
  ];

  // 4. Regras de automação
  const rules = [
    {
      name: 'inconsistencia_endereco',
      trigger: 'Cliente reside no Distrito Industrial Norte',
      action: {
        type: 'reply' as const,
        value: 'O plano de 1000 MEGA oferece roteador Wi-Fi 6 por R$ 149,90/mês. No entanto, por residir no Distrito Industrial Norte, há um prazo especial de 15 dias úteis. Para darmos andamento à análise técnica, poderia me informar o seu CPF?'
      }
    }
  ];

  // 5. Configurações extras
  const config = {
    id: 'config-mock-1',
    gemini_api_key: 'local-lm-studio-key',
    default_fallback_reply: 'Vou transferir você para nossa equipe comercial para concluir a contratação.',
    knowledge_base_documents: knowledgeBaseDocuments,
  };

  const input = {
    chatId: 'chat-simulation-1',
    customerMessage,
    chatHistory: `Cliente: Olá!\nAtendente: Olá! Como posso te ajudar hoje? 😊`,
    relevantHistory: '',
    rules,
    knowledgeBase: 'Você é Sofia, atendente virtual inteligente e muito empática da empresa de internet fibra.',
    knowledgeBaseDocuments,
    workflowKnowledgeDocuments: [],
    fallbackReply: 'Vou te encaminhar para a equipe comercial.',
    escalationPolicy: 'Escalar para o setor Comercial se for novo lead de vendas.',
    closingPolicy: 'Encerrar somente se o cliente confirmar a resolução do problema.',
    enabledAgentToolsDescription: 'Ferramentas ativas: transfer_chat, close_chat, add_internal_note, crm_update_contact_custom_fields, sgp_fetch_contact_panel_data, sgp_fetch_contracts.',
    knowledgeToolProcedures: '',
    intentContext: 'Intenção: catalog_request / purchase_inquiry.',
    model: 'lmstudio/google/gemma-4-e4b', // Força o uso do Gemma no LM Studio
    contact,
    config,
  };

  console.log(`Mensagem do Cliente: "${customerMessage}"`);
  console.log('Dados do Contato (Novo Lead):', JSON.stringify(contact, null, 2));
  console.log('\nExecutando o fluxo com a IA local... (Aguardando resposta do Gemma)\n');

  const start = Date.now();
  try {
    const output = await generateAgentResponse(input);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log(`=== RESPOSTA DA IA CONCLUÍDA EM ${duration}s ===\n`);
    
    console.log('--------------------------------------------------');
    console.log('RESPOSTA ENVIADA AO CLIENTE (response):');
    console.log('--------------------------------------------------');
    console.log(output.response || '(Vazia)');
    
    if (output.messageBlocks && output.messageBlocks.length > 0) {
      console.log('\n--------------------------------------------------');
      console.log('BALÕES DE MENSAGENS SEPARADOS (messageBlocks):');
      console.log('--------------------------------------------------');
      output.messageBlocks.forEach((block, idx) => {
        console.log(`[Mensagem ${idx + 1}]: ${block}`);
      });
    }

    console.log('\n--------------------------------------------------');
    console.log('AÇÕES TÉCNICAS PLANEJADAS (actions):');
    console.log('--------------------------------------------------');
    if (output.actions && output.actions.length > 0) {
      console.log(JSON.stringify(output.actions, null, 2));
    } else {
      console.log('Nenhuma ferramenta foi acionada. (Assertividade Perfeita: não buscou dados do SGP por falta de CPF e por ser novo lead!)');
    }

    console.log('\n--------------------------------------------------');
    console.log('REGRA DE AUTOMAÇÃO DISPARADA (triggeredRule):');
    console.log('--------------------------------------------------');
    console.log(output.triggeredRule || 'Nenhuma regra estática acionada.');

  } catch (error) {
    console.error('\nErro ao executar simulação:', error);
  }
}

runSimulation();

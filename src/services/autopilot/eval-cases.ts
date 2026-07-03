import type { Contact, KnowledgeBaseDocument } from '@/lib/types';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolName } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { KnowledgeCoverage, AutopilotSlotName, UniversalAutopilotIntent } from './intent-types';
import type { WorkflowExecutionMode } from './workflow-engine';
import type { ResponseValidatorDecision } from './response-validator';
import type { ToolPlannerRejectedAction } from './tool-planner';

export type AutopilotEvalExpected = {
  intent: UniversalAutopilotIntent;
  ragCoverageAtLeast?: KnowledgeCoverage;
  ragTopDocumentId?: string;
  workflowExecutionMode?: WorkflowExecutionMode;
  workflowHandled?: boolean;
  missingSlots?: AutopilotSlotName[];
  acceptedTools?: AgentToolName[];
  rejectedToolCodes?: ToolPlannerRejectedAction['code'][];
  validatorDecision?: ResponseValidatorDecision;
  responseIncludes?: string[];
  expectedHandoff?: boolean;
  allowFallback?: boolean;
};

export type AutopilotEvalCase = {
  id: string;
  title: string;
  vertical: string;
  customerMessage: string;
  chatHistory?: string;
  knowledgeDocuments?: KnowledgeBaseDocument[];
  contact?: Contact;
  enabledToolNames?: AgentToolName[];
  availableTeams?: ToolRouterTeam[];
  simulatedResponse?: string | null;
  simulatedActions?: AgentToolAction[];
  simulatedToolResults?: AgentToolExecutionResult[];
  expected: AutopilotEvalExpected;
};

export const DEFAULT_EVAL_CONTACT: Contact = {
  id: 'eval-contact',
  workspace_id: 'eval-workspace',
  name: 'Cliente Eval',
};

export const DEFAULT_EVAL_TEAMS: ToolRouterTeam[] = [
  {
    id: 'team-support',
    name: 'Suporte',
    routingConfig: { enabled: true, autoTransfer: true },
  },
  {
    id: 'team-finance',
    name: 'Financeiro',
    routingConfig: { enabled: true, autoTransfer: true },
  },
  {
    id: 'team-sales',
    name: 'Comercial',
    routingConfig: { enabled: true, autoTransfer: true },
  },
];

export const DEFAULT_EVAL_ENABLED_TOOLS: AgentToolName[] = [
  'transfer_chat',
  'add_internal_note',
  'crm_update_contact_custom_fields',
  'sgp_fetch_contact_panel_data',
  'sgp_fetch_contracts',
  'mcp_call_tool',
];

export const DEFAULT_EVAL_DOCUMENTS: KnowledgeBaseDocument[] = [
  {
    id: 'restaurant-menu',
    name: 'Cardapio oficial',
    category: 'product_or_service_catalog',
    tags: ['menu', 'delivery_menu'],
    priority: 9,
    content: 'Cardapio: Executivo R$ 29,90, Vegetariano R$ 27,90, Combo familia R$ 89,90.',
    canonicalAnswer: 'Temos Executivo por R$ 29,90, Vegetariano por R$ 27,90 e Combo familia por R$ 89,90.',
  },
  {
    id: 'clinic-pricing',
    name: 'Tabela de consultas',
    category: 'pricing',
    tags: ['clinic_service'],
    priority: 10,
    content: 'Consulta inicial R$ 180, retorno em ate 30 dias R$ 90, teleconsulta R$ 140.',
    canonicalAnswer: 'Consulta inicial: R$ 180. Retorno em ate 30 dias: R$ 90. Teleconsulta: R$ 140.',
  },
  {
    id: 'active-offers',
    name: 'Promocoes ativas',
    category: 'offers',
    priority: 8,
    content: 'Campanha vigente: 10% de desconto no primeiro pedido acima de R$ 100 usando cupom BEMVINDO10.',
    canonicalAnswer: 'Hoje temos 10% de desconto no primeiro pedido acima de R$ 100 com o cupom BEMVINDO10.',
  },
  {
    id: 'billing-faq',
    name: 'Financeiro e segunda via',
    category: 'billing',
    priority: 9,
    content: 'Para segunda via de boleto, fatura, pix ou vencimento, valide CPF/CNPJ antes de consultar o sistema.',
  },
  {
    id: 'support-access',
    name: 'Suporte de acesso',
    category: 'troubleshooting',
    priority: 9,
    content: 'Para erro de acesso, aplicativo fora do ar, sinal, conexao ou sistema sem funcionar, valide identificador e consulte status operacional antes de afirmar resolucao.',
  },
  {
    id: 'scheduling-policy',
    name: 'Politica de agendamento',
    category: 'scheduling',
    priority: 7,
    content: 'Agendamentos precisam de data e horario. Quando faltar um desses dados, pergunte objetivamente antes de confirmar.',
  },
  {
    id: 'status-policy',
    name: 'Status de pedidos',
    category: 'order_or_request_status',
    priority: 7,
    content: 'Para status de pedido, entrega, solicitacao ou protocolo, solicite o numero do pedido ou protocolo antes de consultar.',
  },
  {
    id: 'returns-policy',
    name: 'Trocas e devolucoes',
    category: 'returns_or_cancellation',
    priority: 9,
    content: 'Trocas podem ser solicitadas em ate 7 dias corridos com numero do pedido e produto em bom estado.',
    canonicalAnswer: 'Trocas podem ser solicitadas em ate 7 dias corridos. Para seguir, tenha o numero do pedido e mantenha o produto em bom estado.',
  },
  {
    id: 'cancellation-policy',
    name: 'Cancelamento',
    category: 'policy',
    tags: ['cancellation_policy', 'handoff_policy'],
    priority: 10,
    content: 'Para cancelar assinatura ou servico, valide titularidade, registre motivo e confirme possiveis prazos ou multas antes de executar.',
    canonicalAnswer: 'Para cancelamento, validamos titularidade, registramos o motivo e confirmamos prazos ou condicoes aplicaveis antes de executar qualquer mudanca.',
  },
  {
    id: 'document-policy',
    name: 'Documentos e notas',
    category: 'policy',
    tags: ['legal', 'billing'],
    priority: 7,
    content: 'Notas fiscais, contratos, recibos e comprovantes podem exigir titularidade ou identificador cadastrado.',
  },
];

const contactWithCpf: Contact = {
  ...DEFAULT_EVAL_CONTACT,
  custom_fields: { cpf: '529.982.247-25' },
};

const velproPlanCatalogDocument: KnowledgeBaseDocument = {
  id: 'velpro-plan-catalog',
  name: 'Planos de Internet',
  category: 'product_or_service_catalog',
  tags: ['isp_plan_catalog', 'pricing', 'offers'],
  priority: 10,
  content: [
    'Voce deve mandar os planos exatamente com o mesmo espacamento e com os emojis.',
    '',
    'NOSSOS PLANOS DE INTERNET:',
    '',
    '500 MEGA (somente internet)',
    'Wi-Fi 5',
    'R$99,90/mes valor com desconto de pontualidade',
    'R$109,90/mes valor do plano',
    '',
    '1000 MEGA (+ 100 canais de TV)',
    'Wi-Fi 6',
    'R$149,90/mes valor com desconto de pontualidade',
    'R$159,90/mes valor do plano',
  ].join('\n'),
};

export const AUTOPILOT_OFFLINE_EVAL_CASES: AutopilotEvalCase[] = [
  {
    id: 'catalog_restaurant_menu',
    title: 'Cliente pede cardapio com opcoes',
    vertical: 'restaurante',
    customerMessage: 'Me manda o cardapio com as opcoes, por favor',
    simulatedResponse: 'Temos Executivo por R$ 29,90, Vegetariano por R$ 27,90 e Combo familia por R$ 89,90.',
    expected: {
      intent: 'catalog_request',
      ragCoverageAtLeast: 'high',
      ragTopDocumentId: 'restaurant-menu',
      workflowExecutionMode: 'continue_llm',
      validatorDecision: 'approve',
      responseIncludes: ['Executivo', 'Vegetariano'],
    },
  },
  {
    id: 'pricing_clinic_consultation',
    title: 'Cliente pergunta preco de consulta',
    vertical: 'clinica',
    customerMessage: 'Qual o valor da consulta e do retorno?',
    simulatedResponse: 'A consulta inicial custa R$ 180 e o retorno em ate 30 dias custa R$ 90.',
    expected: {
      intent: 'pricing_request',
      ragCoverageAtLeast: 'high',
      ragTopDocumentId: 'clinic-pricing',
      validatorDecision: 'approve',
      responseIncludes: ['R$ 180'],
    },
  },
  {
    id: 'promotion_ecommerce_coupon',
    title: 'Cliente pede promocao ativa',
    vertical: 'ecommerce',
    customerMessage: 'Tem alguma promocao ou cupom hoje?',
    simulatedResponse: 'Temos 10% de desconto no primeiro pedido acima de R$ 100 usando o cupom BEMVINDO10.',
    expected: {
      intent: 'promotion_request',
      ragCoverageAtLeast: 'high',
      ragTopDocumentId: 'active-offers',
      validatorDecision: 'approve',
      responseIncludes: ['BEMVINDO10'],
    },
  },
  {
    id: 'isp_specific_plan_selection_after_catalog',
    title: 'Cliente escolhe plano especifico apos receber catalogo',
    vertical: 'isp',
    customerMessage: 'Esse de 1000 MEGA',
    chatHistory: [
      'Atendente: NOSSOS PLANOS DE INTERNET:',
      '500 MEGA (somente internet)',
      '1000 MEGA (+ 100 canais de TV)',
      'Algum desses planos te interessou?',
    ].join('\n'),
    knowledgeDocuments: [velproPlanCatalogDocument],
    expected: {
      intent: 'purchase_inquiry',
      ragCoverageAtLeast: 'high',
      ragTopDocumentId: 'velpro-plan-catalog',
      workflowExecutionMode: 'continue_llm',
      workflowHandled: false,
      validatorDecision: 'approve',
    },
  },
  {
    id: 'billing_missing_identifier',
    title: 'Financeiro pede CPF antes da segunda via',
    vertical: 'financeiro',
    customerMessage: 'Preciso da segunda via do boleto',
    enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    expected: {
      intent: 'billing_or_payment',
      ragCoverageAtLeast: 'high',
      workflowExecutionMode: 'continue_llm',
      workflowHandled: false,
      validatorDecision: 'approve',
    },
  },
  {
    id: 'billing_identifier_lookup',
    title: 'Financeiro consulta SGP com CPF informado',
    vertical: 'financeiro',
    customerMessage: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
    enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    simulatedResponse: 'Posso ajudar com sua solicitacao financeira. Qual informacao voce precisa?',
    expected: {
      intent: 'billing_or_payment',
      workflowExecutionMode: 'continue_llm',
      workflowHandled: false,
      validatorDecision: 'approve',
    },
  },
  {
    id: 'support_missing_identifier',
    title: 'Suporte operacional pede CPF antes de consultar',
    vertical: 'suporte',
    customerMessage: 'Estou sem acesso e quero que verifique minha conexao',
    enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    expected: {
      intent: 'troubleshooting',
      workflowExecutionMode: 'continue_llm',
      workflowHandled: false,
      validatorDecision: 'approve',
    },
  },
  {
    id: 'support_identifier_lookup',
    title: 'Suporte operacional consulta status com CPF',
    vertical: 'suporte',
    customerMessage: 'Estou sem acesso e meu CPF e 529.982.247-25',
    enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
    simulatedResponse: 'Me conte mais detalhes sobre o problema para eu orientar os proximos passos.',
    expected: {
      intent: 'troubleshooting',
      workflowExecutionMode: 'continue_llm',
      workflowHandled: false,
      validatorDecision: 'approve',
    },
  },
  {
    id: 'scheduling_missing_time',
    title: 'Agendamento pergunta horario ausente',
    vertical: 'clinica',
    customerMessage: 'Quero agendar uma consulta amanha',
    enabledToolNames: ['mcp_call_tool'],
    expected: {
      intent: 'scheduling_request',
      workflowExecutionMode: 'direct_response',
      workflowHandled: true,
      missingSlots: ['time'],
      validatorDecision: 'approve',
      responseIncludes: ['horario'],
    },
  },
  {
    id: 'status_missing_protocol',
    title: 'Status pede numero do pedido',
    vertical: 'ecommerce',
    customerMessage: 'Qual o status do meu pedido?',
    enabledToolNames: ['mcp_call_tool'],
    expected: {
      intent: 'order_or_request_status',
      workflowExecutionMode: 'direct_response',
      workflowHandled: true,
      missingSlots: ['order_or_request_id'],
      validatorDecision: 'approve',
      responseIncludes: ['pedido'],
    },
  },
  {
    id: 'human_handoff_explicit',
    title: 'Cliente pede atendimento humano',
    vertical: 'geral',
    customerMessage: 'Quero falar com um atendente humano agora',
    enabledToolNames: ['transfer_chat', 'add_internal_note'],
    expected: {
      intent: 'human_handoff',
      workflowExecutionMode: 'direct_response',
      workflowHandled: true,
      acceptedTools: ['add_internal_note', 'transfer_chat'],
      validatorDecision: 'approve',
      expectedHandoff: true,
    },
  },
  {
    id: 'complaint_transfer_promise',
    title: 'Reclamacao nao vira handoff apenas porque a resposta promete equipe',
    vertical: 'sac',
    customerMessage: 'Estou insatisfeito, isso e um absurdo',
    enabledToolNames: ['transfer_chat', 'add_internal_note'],
    simulatedResponse: 'Vou encaminhar para a equipe responsavel.',
    expected: {
      intent: 'complaint',
      workflowExecutionMode: 'continue_llm',
      validatorDecision: 'repair',
      expectedHandoff: false,
      allowFallback: true,
    },
  },
  {
    id: 'return_policy_official',
    title: 'Agente responde politica de troca usando a base',
    vertical: 'ecommerce',
    customerMessage: 'Quero fazer uma troca de produto',
    simulatedResponse: 'A troca pode ser solicitada em ate 7 dias corridos, com o numero do pedido e o produto em bom estado.',
    expected: {
      intent: 'return_or_refund',
      ragCoverageAtLeast: 'high',
      ragTopDocumentId: 'returns-policy',
      validatorDecision: 'approve',
      responseIncludes: ['7 dias'],
    },
  },
  {
    id: 'cancellation_policy_official',
    title: 'Agente responde cancelamento usando a base',
    vertical: 'assinatura',
    customerMessage: 'Quero cancelar minha assinatura',
    simulatedResponse: 'Para cancelar, preciso validar a titularidade e confirmar as condicoes aplicaveis antes de executar qualquer mudanca.',
    expected: {
      intent: 'cancellation_request',
      ragCoverageAtLeast: 'high',
      ragTopDocumentId: 'cancellation-policy',
      validatorDecision: 'approve',
      responseIncludes: ['titularidade'],
    },
  },
  {
    id: 'document_request_invoice',
    title: 'Pedido de nota fiscal reconhece documento',
    vertical: 'ecommerce',
    customerMessage: 'Preciso da nota fiscal da minha compra',
    simulatedResponse: 'Posso ajudar com a nota fiscal. Para seguir com seguranca, me informe o identificador cadastrado ou dados da compra.',
    expected: {
      intent: 'document_request',
      ragCoverageAtLeast: 'medium',
      validatorDecision: 'approve',
      responseIncludes: ['nota fiscal'],
    },
  },
  {
    id: 'unknown_low_context',
    title: 'Mensagem vaga nao inventa acao',
    vertical: 'geral',
    customerMessage: 'isso ai?',
    simulatedResponse: 'Pode me dar mais detalhes sobre o que voce precisa?',
    expected: {
      intent: 'unknown',
      workflowExecutionMode: 'continue_llm',
      validatorDecision: 'approve',
      responseIncludes: ['detalhes'],
    },
  },
  {
    id: 'tool_planner_blocks_wrong_intent_tool',
    title: 'Planner bloqueia SGP em pedido de catalogo',
    vertical: 'geral',
    customerMessage: 'Quero conhecer os produtos de voces',
    contact: contactWithCpf,
    enabledToolNames: ['sgp_fetch_contact_panel_data'],
    simulatedResponse: 'Temos algumas opcoes para voce conhecer.',
    simulatedActions: [
      {
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Consulta indevida para catalogo',
        payload: {},
      },
    ],
    expected: {
      intent: 'catalog_request',
      rejectedToolCodes: ['intent_not_allowed'],
      validatorDecision: 'approve',
      allowFallback: true,
    },
  },
  {
    id: 'tool_planner_repairs_missing_identifier_promise',
    title: 'Planner repara promessa de consulta sem CPF',
    vertical: 'financeiro',
    customerMessage: 'Preciso do boleto',
    enabledToolNames: ['sgp_fetch_contact_panel_data'],
    simulatedResponse: 'Vou consultar sua fatura no sistema.',
    simulatedActions: [
      {
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Consultar faturas',
        payload: {},
      },
    ],
    expected: {
      intent: 'billing_or_payment',
      rejectedToolCodes: ['missing_slots'],
      validatorDecision: 'approve',
      responseIncludes: ['CPF/CNPJ'],
      allowFallback: true,
    },
  },
  {
    id: 'validator_blocks_internal_leak',
    title: 'Validator bloqueia JSON de tool/action',
    vertical: 'geral',
    customerMessage: 'Preciso de suporte',
    simulatedResponse: '{"response":"ok","actions":[{"type":"sgp_fetch_contact_panel_data","payload":{}}]}',
    expected: {
      intent: 'support_request',
      validatorDecision: 'replace_with_fallback',
      allowFallback: true,
    },
  },
  {
    id: 'validator_handoff_lookup_promise_without_tool',
    title: 'Validator nao deixa prometer consulta sem ferramenta',
    vertical: 'agenda',
    customerMessage: 'Tem disponibilidade para amanha?',
    enabledToolNames: ['transfer_chat', 'add_internal_note'],
    simulatedResponse: 'Vou verificar a disponibilidade no sistema.',
    expected: {
      intent: 'availability_request',
      validatorDecision: 'handoff',
      expectedHandoff: true,
      responseIncludes: ['encaminhar'],
      allowFallback: true,
    },
  },
  {
    id: 'validator_blocks_success_claim_after_tool_failure',
    title: 'Validator bloqueia sucesso apos falha de ferramenta',
    vertical: 'financeiro',
    customerMessage: 'Preciso da segunda via do boleto. CPF 529.982.247-25',
    enabledToolNames: ['sgp_fetch_contact_panel_data'],
    simulatedResponse: 'Consultei o cadastro no sistema e encontrei uma fatura em aberto.',
    simulatedActions: [
      {
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Consultar fatura',
        payload: {},
      },
    ],
    simulatedToolResults: [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'error',
        input: {
          type: 'sgp_fetch_contact_panel_data',
          reason: 'Consultar fatura',
          payload: {},
        },
        error: 'timeout',
      },
    ],
    expected: {
      intent: 'billing_or_payment',
      acceptedTools: ['sgp_fetch_contact_panel_data'],
      validatorDecision: 'replace_with_fallback',
      responseIncludes: ['Nao consegui concluir'],
      allowFallback: true,
    },
  },
  {
    id: 'rag_prioritizes_support_over_catalog',
    title: 'RAG escolhe suporte quando pergunta e problema',
    vertical: 'saas',
    customerMessage: 'O aplicativo nao funciona e mostra erro de acesso',
    enabledToolNames: ['transfer_chat', 'add_internal_note'],
    simulatedResponse: 'Para erro de acesso, preciso entender o sintoma e validar o cadastro antes de afirmar uma solucao.',
    expected: {
      intent: 'troubleshooting',
      ragCoverageAtLeast: 'high',
      ragTopDocumentId: 'support-access',
      workflowExecutionMode: 'continue_llm',
      validatorDecision: 'approve',
      responseIncludes: ['erro de acesso'],
    },
  },
];

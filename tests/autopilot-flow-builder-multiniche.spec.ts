import { describe, expect, it } from 'vitest';

import { sanitizeAutopilotFlowProposal } from '@/ai/flows/autopilot-flow-builder';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { auditAutopilotFlowGraph } from '@/services/autopilot/flow-audit';
import { graphUsesOnlyV2Nodes, V2_FLOW_NODE_KINDS } from '@/services/autopilot/flow-v2';

type NicheFixture = {
  id: string;
  title: string;
  prompt: string;
  primaryRoute: {
    id: string;
    label: string;
    description: string;
    examples: string[];
    requiredSlots: string[];
  };
  secondaryRoute: {
    id: string;
    label: string;
    description: string;
    examples: string[];
  };
  collectFields: Array<{
    id: string;
    label: string;
    fieldKey: string;
    type: 'text' | 'name' | 'phone' | 'email' | 'document' | 'date' | 'time' | 'address' | 'number';
  }>;
};

const niches: NicheFixture[] = [
  {
    id: 'clinica',
    title: 'Clinica multiprofissional',
    prompt: 'Triar sintomas, orientar com base e agendar consulta sem pular sinais de alerta.',
    primaryRoute: {
      id: 'agendar_consulta',
      label: 'Agendar consulta',
      description: 'Cliente quer consulta ou avaliacao com profissional.',
      examples: ['Quero marcar uma consulta para amanha', 'Preciso agendar avaliacao'],
      requiredSlots: ['name', 'phone', 'date', 'time'],
    },
    secondaryRoute: {
      id: 'duvida_clinica',
      label: 'Duvida clinica',
      description: 'Cliente quer orientacao geral antes de agendar.',
      examples: ['Estou com dor e queria saber se preciso consultar', 'Quais sintomas devo observar?'],
    },
    collectFields: [
      { id: 'nome', label: 'Nome completo', fieldKey: 'name', type: 'name' },
      { id: 'telefone', label: 'Telefone com DDD', fieldKey: 'phone', type: 'phone' },
      { id: 'data', label: 'Data desejada', fieldKey: 'date', type: 'date' },
      { id: 'horario', label: 'Horario desejado', fieldKey: 'time', type: 'time' },
    ],
  },
  {
    id: 'isp',
    title: 'Provedor de internet',
    prompt: 'Diagnosticar queda de conexao, lentidao, LOS e encaminhar suporte humano quando necessario.',
    primaryRoute: {
      id: 'suporte_tecnico',
      label: 'Suporte tecnico',
      description: 'Cliente relata internet lenta, sem sinal ou roteador com problema.',
      examples: ['Minha internet caiu agora', 'A luz LOS esta vermelha'],
      requiredSlots: ['customer_identifier', 'address'],
    },
    secondaryRoute: {
      id: 'duvida_planos',
      label: 'Duvida sobre planos',
      description: 'Cliente pergunta velocidade, cobertura ou troca de plano.',
      examples: ['Quais planos tem no meu bairro?', 'Quero trocar para um plano maior'],
    },
    collectFields: [
      { id: 'documento', label: 'CPF/CNPJ do titular', fieldKey: 'customer_identifier', type: 'document' },
      { id: 'endereco', label: 'Endereco de instalacao', fieldKey: 'address', type: 'address' },
    ],
  },
  {
    id: 'ecommerce',
    title: 'E-commerce',
    prompt: 'Atender status de pedido, troca, devolucao e duvidas de produto com base de conhecimento.',
    primaryRoute: {
      id: 'status_pedido',
      label: 'Status do pedido',
      description: 'Cliente quer rastrear pedido ou saber previsao de entrega.',
      examples: ['Onde esta meu pedido?', 'Quero rastrear a compra 1234'],
      requiredSlots: ['order_or_request_id', 'email'],
    },
    secondaryRoute: {
      id: 'troca_devolucao',
      label: 'Troca ou devolucao',
      description: 'Cliente quer politica, prazo ou orientacao de devolucao.',
      examples: ['Quero devolver um produto', 'Como faco troca de tamanho?'],
    },
    collectFields: [
      { id: 'pedido', label: 'Numero do pedido', fieldKey: 'order_or_request_id', type: 'text' },
      { id: 'email', label: 'E-mail da compra', fieldKey: 'email', type: 'email' },
    ],
  },
  {
    id: 'financeiro',
    title: 'Assessoria financeira',
    prompt: 'Qualificar solicitacoes de boleto, negociacao, comprovante e contestacao financeira.',
    primaryRoute: {
      id: 'negociacao',
      label: 'Negociacao financeira',
      description: 'Cliente quer renegociar, emitir boleto ou revisar uma cobranca.',
      examples: ['Quero negociar uma fatura atrasada', 'Preciso da segunda via do boleto'],
      requiredSlots: ['customer_identifier', 'phone'],
    },
    secondaryRoute: {
      id: 'duvida_financeira',
      label: 'Duvida financeira',
      description: 'Cliente pergunta prazo, taxa, politica ou comprovante.',
      examples: ['Qual o prazo de compensacao?', 'Como envio comprovante?'],
    },
    collectFields: [
      { id: 'documento', label: 'CPF/CNPJ', fieldKey: 'customer_identifier', type: 'document' },
      { id: 'telefone', label: 'Telefone de contato', fieldKey: 'phone', type: 'phone' },
    ],
  },
  {
    id: 'educacao',
    title: 'Escola de cursos',
    prompt: 'Atender interessados em matricula, bolsa, agenda de turma e suporte academico.',
    primaryRoute: {
      id: 'matricula',
      label: 'Matricula',
      description: 'Aluno quer se matricular ou receber proposta de curso.',
      examples: ['Quero me matricular no curso de ingles', 'Tem turma de programacao?'],
      requiredSlots: ['name', 'phone', 'product_or_service_preference'],
    },
    secondaryRoute: {
      id: 'suporte_aluno',
      label: 'Suporte ao aluno',
      description: 'Aluno atual precisa de segunda via, horario, certificado ou remarcacao.',
      examples: ['Preciso remarcar minha aula', 'Como pego meu certificado?'],
    },
    collectFields: [
      { id: 'nome', label: 'Nome do interessado', fieldKey: 'name', type: 'name' },
      { id: 'telefone', label: 'WhatsApp', fieldKey: 'phone', type: 'phone' },
      { id: 'curso', label: 'Curso de interesse', fieldKey: 'product_or_service_preference', type: 'text' },
    ],
  },
  {
    id: 'restaurante',
    title: 'Restaurante',
    prompt: 'Gerenciar reservas, delivery, eventos e perguntas sobre cardapio/alergênicos.',
    primaryRoute: {
      id: 'reserva',
      label: 'Reserva de mesa',
      description: 'Cliente quer reservar mesa, evento ou confirmar disponibilidade.',
      examples: ['Quero reservar mesa para sexta a noite', 'Tem lugar para 8 pessoas hoje?'],
      requiredSlots: ['name', 'phone', 'date', 'time', 'quantity'],
    },
    secondaryRoute: {
      id: 'duvida_cardapio',
      label: 'Duvida de cardapio',
      description: 'Cliente pergunta pratos, alergênicos, horario ou delivery.',
      examples: ['Tem opcao sem lactose?', 'Qual o horario do delivery?'],
    },
    collectFields: [
      { id: 'nome', label: 'Nome da reserva', fieldKey: 'name', type: 'name' },
      { id: 'telefone', label: 'Telefone com DDD', fieldKey: 'phone', type: 'phone' },
      { id: 'data', label: 'Data da reserva', fieldKey: 'date', type: 'date' },
      { id: 'hora', label: 'Horario da reserva', fieldKey: 'time', type: 'time' },
      { id: 'pessoas', label: 'Quantidade de pessoas', fieldKey: 'quantity', type: 'number' },
    ],
  },
];

function buildFlowBuilderDraft(niche: NicheFixture) {
  const baseX = 80;
  const nodeId = (suffix: string) => `${niche.id}-${suffix}`;
  return {
    summary: `Fluxo ${niche.title}: ${niche.prompt}`,
    procedureManifest: [
      `Objetivo: ${niche.prompt}`,
      'Passos: acolher, classificar, coletar dados quando necessario, consultar knowledge, responder e finalizar.',
      `Decisoes: ${niche.primaryRoute.label}, ${niche.secondaryRoute.label}, humano.`,
      'Final possivel: atendimento concluido ou transferencia humana.',
    ].join('\n'),
    systemPrompt: `Atue no nicho ${niche.title}. Use @${niche.id}_base antes de respostas factuais e siga @${niche.id}_responder.`,
    nodes: [
      { id: nodeId('start'), kind: 'start' as const, title: 'Start', subtitle: 'Entrada do fluxo', x: baseX, y: 120 },
      { id: nodeId('welcome'), kind: 'message' as const, title: 'Boas-vindas', subtitle: `Atendimento ${niche.title}`, x: baseX + 220, y: 120 },
      {
        id: nodeId('decision'),
        kind: 'decision' as const,
        title: 'Classificacao principal',
        subtitle: 'Escolher rota operacional',
        x: baseX + 460,
        y: 120,
        instructions: 'Escolha somente uma rota configurada. Use fallback quando houver baixa confianca ou mudanca de assunto.',
        referenceId: `${niche.id}_decision`,
        switchMode: 'ai' as const,
        confidenceThreshold: 0.8,
        routes: [
          {
            ...niche.primaryRoute,
            targetNodeId: nodeId('collect'),
          },
          {
            ...niche.secondaryRoute,
            targetNodeId: nodeId('responder'),
          },
          {
            id: 'humano',
            label: 'Pedido por humano',
            description: 'Cliente pede atendente humano, escalonamento ou situacao fora do bot.',
            examples: ['Quero falar com uma pessoa', 'Me transfere para um atendente'],
            targetNodeId: nodeId('handoff'),
          },
        ],
      },
      {
        id: nodeId('collect'),
        kind: 'collect' as const,
        title: `Coleta - ${niche.primaryRoute.label}`,
        subtitle: 'Dados tipados obrigatorios',
        x: baseX + 730,
        y: 40,
        message: 'Para seguir com seguranca, preciso confirmar alguns dados.',
        formFields: niche.collectFields.map((field) => ({
          ...field,
          required: true,
          placeholder: field.label,
        })),
      },
      {
        id: nodeId('base'),
        kind: 'knowledge' as const,
        title: 'Base de conhecimento',
        subtitle: `Knowledge ${niche.title}`,
        x: baseX + 730,
        y: 260,
        referenceId: `${niche.id}_base`,
        requiredKnowledgeCoverage: 'medium' as const,
        instructions: 'Buscar politica, procedimento, limites, prazos e respostas oficiais da base antes do sub-agente responder.',
      },
      {
        id: nodeId('responder'),
        kind: 'sub_agent' as const,
        title: `Sub-agent ${niche.title}`,
        subtitle: 'Resposta grounded',
        x: baseX + 1000,
        y: 160,
        referenceId: `${niche.id}_responder`,
        requiredKnowledgeCoverage: 'medium' as const,
        instructions: 'Responder usando somente slots confirmados, ferramentas executadas e chunks da base. Se a base nao cobrir, reconhecer limite e encaminhar com seguranca.',
      },
      {
        id: nodeId('handoff'),
        kind: 'handoff' as const,
        title: 'Transferir para humano',
        subtitle: 'Escalonamento seguro',
        x: baseX + 1000,
        y: -40,
        message: 'Vou transferir para a equipe humana responsavel continuar com seguranca.',
      },
      {
        id: nodeId('end'),
        kind: 'end' as const,
        title: 'Fim',
        subtitle: 'Atendimento concluido',
        x: baseX + 1260,
        y: 160,
        message: 'Atendimento concluido. Obrigado pelo contato.',
      },
    ],
    edges: [
      { source: nodeId('start'), target: nodeId('welcome') },
      { source: nodeId('welcome'), target: nodeId('decision') },
      { source: nodeId('decision'), target: nodeId('collect'), routeId: niche.primaryRoute.id },
      { source: nodeId('decision'), target: nodeId('responder'), routeId: niche.secondaryRoute.id },
      { source: nodeId('decision'), target: nodeId('handoff'), routeId: 'humano' },
      { source: nodeId('collect'), target: nodeId('responder') },
      { source: nodeId('base'), target: nodeId('responder') },
      { source: nodeId('responder'), target: nodeId('end') },
    ],
  };
}

describe('autopilot FlowBuilder multi-niche proposals', () => {
  it.each(niches)('generates a gate-clean formatted V2 flow for $title', (niche) => {
    const proposal = sanitizeAutopilotFlowProposal(buildFlowBuilderDraft(niche), listAgentToolCatalogItems());
    const audit = auditAutopilotFlowGraph(proposal.flowGraph);
    const failedSimulations = audit.simulations.filter((simulation) => simulation.status === 'failed');
    const warningSimulations = audit.simulations.filter((simulation) => simulation.status === 'warning');
    const nodeKinds = proposal.flowGraph.nodes.map((node) => node.kind);

    expect(graphUsesOnlyV2Nodes(proposal.flowGraph)).toBe(true);
    expect(nodeKinds.every((kind) => V2_FLOW_NODE_KINDS.includes(kind as any))).toBe(true);
    expect(proposal.flowGraph.nodes.every((node) => Boolean(node.config?.referenceId?.trim()))).toBe(true);
    expect(proposal.flowGraph.nodes.every((node) => Boolean(node.config?.instructions?.trim()))).toBe(true);
    expect(proposal.flowGraph.nodes.filter((node) => node.kind === 'collect')).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({
          formFields: expect.arrayContaining([
            expect.objectContaining({ type: expect.any(String), required: true }),
          ]),
        }),
      }),
    ]);

    const decisions = proposal.flowGraph.nodes.filter((node) => node.kind === 'decision');
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      const fallbackRoute = decision.config?.routes?.find((route) => route.id === decision.config?.fallbackRouteId);
      const fallbackTarget = proposal.flowGraph.nodes.find((node) => node.id === fallbackRoute?.targetNodeId);
      expect(fallbackRoute).toBeTruthy();
      expect(fallbackTarget?.kind).toBe('message');
      expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: decision.id,
          target: fallbackTarget?.id,
          routeId: fallbackRoute?.id,
        }),
      ]));
    }

    expect(audit.status).toBe('passed');
    expect(audit.issues).toEqual([]);
    expect(failedSimulations).toEqual([]);
    expect(warningSimulations).toEqual([]);
  });
});

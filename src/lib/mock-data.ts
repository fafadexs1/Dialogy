
import type { Chat, User, InternalChannel, InternalMessage, CustomFieldDefinition, SelectableOption, Tag, Workspace, NexusFlowInstance, Contact, Activity } from './types';

export const workspaces: Workspace[] = [
    { id: 'ws-1', name: 'Dialogy Inc.', avatar: 'https://placehold.co/40x40.png' },
    { id: 'ws-2', name: 'InnovateTech', avatar: 'https://placehold.co/40x40.png' },
    { id: 'ws-3', name: 'Alex\'s Freelance', avatar: 'https://placehold.co/40x40.png' },
]

export const agents: User[] = [
  { 
    id: 'agent-1', 
    firstName: 'Alex', 
    lastName: 'Johnson', 
    name: 'Alex Johnson', 
    avatar: 'https://placehold.co/40x40.png', 
    email: 'agent@dialogy.com',
    workspaces: workspaces,
    activeWorkspaceId: 'ws-1',
    memberSince: 'Jan 2024',
    geminiUsage: 15.70,
  },
  { id: 'agent-2', firstName: 'Maria', lastName: 'Garcia', name: 'Maria Garcia', avatar: 'https://placehold.co/40x40.png', email: 'maria@dialogy.com', memberSince: 'Fev 2024', geminiUsage: 8.45 },
  { id: 'agent-3', firstName: 'David', lastName: 'Smith', name: 'David Smith', avatar: 'https://placehold.co/40x40.png', email: 'david@dialogy.com', memberSince: 'Dez 2023', geminiUsage: 22.10 },
  { id: 'agent-4', firstName: 'Sophia', lastName: 'Brown', name: 'Sophia Brown', avatar: 'https://placehold.co/40x40.png', email: 'sophia@dialogy.com', memberSince: 'Mar 2024', geminiUsage: 2.30 },
];

export const mockTags: Tag[] = [
  { id: 'tag-1', value: 'prospect-quente', label: 'Prospect Quente', color: '#FEE2E2', is_close_reason: false },
  { id: 'tag-2', value: 'cliente-ativo', label: 'Cliente Ativo', color: '#D1FAE5', is_close_reason: false },
  { id: 'tag-3', value: 'sem-viabilidade', label: 'Sem Viabilidade', color: '#E5E7EB', is_close_reason: false },
  { id: 'tag-4', value: 'ex-cliente', label: 'Ex-Cliente', color: '#FEF9C3', is_close_reason: false },
  { id: 'tag-5', value: 'prospect', label: 'Prospect', color: '#DBEAFE', is_close_reason: false },
  { id: 'tag-6', value: 'problema-resolvido', label: 'Problema Resolvido', color: '#22c55e', is_close_reason: true },
  { id: 'tag-7', value: 'sem-resposta', label: 'Cliente sem resposta', color: '#6b7280', is_close_reason: true },
];

export const leadSources: SelectableOption[] = [
    { id: 'ls-1', value: 'website', label: 'Site', color: '#10b981' },
    { id: 'ls-2', value: 'referral', label: 'Indicação', color: '#3b82f6' },
    { id: 'ls-3', value: 'event', label: 'Evento', color: '#8b5cf6' },
    { id: 'ls-4', value: 'outbound', label: 'Prospecção Ativa', color: '#f97316' },
];
export const contactChannels: SelectableOption[] = [
    { id: 'cc-1', value: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
    { id: 'cc-2', value: 'website-chat', label: 'Chat no Site', color: '#3b82f6' },
    { id: 'cc-3', value: 'phone', label: 'Ligação Telefônica', color: '#6366f1' },
    { id: 'cc-4', value: 'email', label: 'E-mail', color: '#ea580c' },
    { id: 'cc-5', value: 'form', label: 'Formulário de Contato', color: '#9333ea' },
];
export const jobTitles: SelectableOption[] = [
    { id: 'jt-1', value: 'sales-director', label: 'Diretor de Vendas', color: '#ef4444' },
    { id: 'jt-2', value: 'marketing-manager', label: 'Gerente de Marketing', color: '#f97316' },
    { id: 'jt-3', value: 'it-analyst', label: 'Analista de TI', color: '#3b82f6' },
    { id: 'jt-4', value: 'ceo', label: 'CEO', color: '#1f2937' },
];

export const mockCustomFieldDefinitions: CustomFieldDefinition[] = [
    { id: 'budget', label: 'Orçamento Anual', type: 'text', placeholder: 'R$ 50.000' },
    { id: 'product_interest', label: 'Produto de Interesse', type: 'text', placeholder: 'Software de Gestão' },
    { id: 'birthday', label: 'Data de Aniversário', type: 'date', placeholder: '' },
    { id: 'legacy_id', label: 'ID do Cliente no Sistema Antigo', type: 'text', placeholder: 'XYZ-123' },
];

const sampleActivities: Activity[] = [
    {type: 'viabilidade', date: '2025-05-06', notes: 'Viabilidade técnica OK para o endereço.'},
    {type: 'ligacao', date: '2025-05-01', notes: 'Primeiro contacto, interesse no plano 500MB.'},
    {type: 'nota', date: '2025-05-07', notes: 'Cliente contactou suporte sobre velocidade (resolvido).'},
];

export const contacts: Contact[] = [
    { 
      id: 'CRM001', 
      workspace_id: 'ws-1',
      name: 'Marcos Oliveira', 
      email: 'marcos.o@emailaleatorio.com', 
      phone: '(11) 99988-7766', 
      owner_id: 'agent-1',
      last_activity: '2025-05-06',
      tags: [mockTags[0], mockTags[1]],
      activities: [sampleActivities[0], sampleActivities[1]],
    },
    { 
      id: 'CRM002',
      workspace_id: 'ws-1',
      name: 'Beatriz Santos', 
      email: 'bia.santos@email.com', 
      phone: '(21) 98877-6655', 
      owner_id: 'agent-2',
      last_activity: '2025-05-07',
      tags: [mockTags[1]],
      activities: [sampleActivities[2]],
    },
];

export const chats: Chat[] = [
  {
    id: 'chat-1',
    workspace_id: 'ws-1',
    contact: contacts[0],
    status: 'atendimentos',
    messages: [
    ],
  },
  {
    id: 'chat-2',
    workspace_id: 'ws-1',
    contact: contacts[1],
    status: 'atendimentos',
    messages: [
    ],
  },
];

export const internalChannels: InternalChannel[] = [
    {
      id: 'channel-1',
      name: 'geral',
      type: 'channel',
      members: agents,
      unreadCount: 2,
    },
    {
      id: 'channel-2',
      name: 'vendas',
      type: 'channel',
      members: [agents[0], agents[2]],
    },
    {
      id: 'dm-1',
      name: 'Maria Garcia',
      type: 'dm',
      recipient: agents[1],
      unreadCount: 1,
      members: [agents[0], agents[1]],
    },
    {
        id: 'dm-2',
        name: 'David Smith',
        type: 'dm',
        recipient: agents[2],
        members: [agents[0], agents[2]],
    },
];

export const internalMessages: InternalMessage[] = [
    { id: 'imsg-1', channelId: 'channel-1', sender: agents[1], content: 'Pessoal, a meta do trimestre foi batida! 🎉', timestamp: '1:15 PM' },
    { id: 'imsg-2', channelId: 'vendas', sender: agents[3], content: '@Alex Johnson pode me ajudar a preparar a proposta para a Logística Global?', timestamp: '1:16 PM' },
    { id: 'imsg-3', channelId: 'vendas', sender: agents[0], content: 'Claro, te chamo no privado.', timestamp: '1:17 PM' },
    { id: 'imsg-4', channelId: 'dm-1', sender: agents[1], content: 'Oi Alex, você está livre para uma rápida chamada?', timestamp: '2:30 PM' },
    { id: 'imsg-5', channelId: 'dm-1', sender: agents[0], content: 'Sim, me liga em 5 minutos.', timestamp: '2:31 PM' },
];

export const getContactById = (id: string) => contacts.find(c => c.id === id);


export const nexusFlowInstances: NexusFlowInstance[] = [
  { 
    id: 'nfi-1', 
    name: 'Aviso de Instabilidade', 
    trigger: 'Cliente menciona que o sistema está "fora do ar", "lento" ou "instável".',
    action: {
      type: 'reply',
      value: 'Peço desculpas pelo transtorno. Estamos cientes de uma instabilidade temporária e a engenharia já está trabalhando para normalizar o serviço.'
    },
    enabled: true,
    model: 'googleai/gemini-2.0-flash',
  },
  { 
    id: 'nfi-2', 
    name: 'Dúvida sobre Fatura', 
    trigger: 'Cliente pergunta sobre a "fatura", "boleto" ou "pagamento".',
    action: {
      type: 'reply',
      value: 'Entendi. Para que eu possa ajudar com sua dúvida financeira, estou transferindo seu atendimento para um especialista do nosso time financeiro, ok?'
    },
    enabled: true,
    model: 'googleai/gemini-2.0-flash',
  },
  { 
    id: 'nfi-3', 
    name: 'Registrar Lead no CRM', 
    trigger: 'Cliente demonstra interesse em comprar ou pede um orçamento.',
    action: {
        type: 'webhook',
        url: 'https://api.crm.com/leads',
        method: 'POST',
        body: {
            name: '{{contact.name}}',
            email: '{{contact.email}}',
            source: 'Dialogy Chat'
        }
    },
    enabled: false,
    model: 'googleai/gemini-2.0-flash',
  },
];

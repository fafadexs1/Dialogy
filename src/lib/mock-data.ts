import type { Chat, User, InternalChannel, InternalMessage, CustomFieldDefinition, SelectableOption, Tag, Workspace, Integration, NexusFlowInstance, Contact } from './types';

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
    online: true, 
    email: 'agent@dialogy.com',
    workspaces: workspaces,
    activeWorkspaceId: 'ws-1',
    memberSince: 'Jan 2024',
    geminiUsage: 15.70,
  },
  { id: 'agent-2', firstName: 'Maria', lastName: 'Garcia', name: 'Maria Garcia', avatar: 'https://placehold.co/40x40.png', online: true, email: 'maria@dialogy.com', memberSince: 'Fev 2024', geminiUsage: 8.45 },
  { id: 'agent-3', firstName: 'David', lastName: 'Smith', name: 'David Smith', avatar: 'https://placehold.co/40x40.png', online: false, email: 'david@dialogy.com', memberSince: 'Dez 2023', geminiUsage: 22.10 },
  { id: 'agent-4', firstName: 'Sophia', lastName: 'Brown', name: 'Sophia Brown', avatar: 'https://placehold.co/40x40.png', online: true, email: 'sophia@dialogy.com', memberSince: 'Mar 2024', geminiUsage: 2.30 },
];

export const mockTags: Tag[] = [
  { id: 'tag-1', value: 'hot-lead', label: 'Hot Lead', color: '#ef4444' },
  { id: 'tag-2', value: 'saas-customer', label: 'SaaS Customer', color: '#3b82f6' },
  { id: 'tag-3', value: 'needs-follow-up', label: 'Needs Follow-Up', color: '#eab308' },
  { id: 'tag-4', value: 'enterprise', label: 'Enterprise', color: '#8b5cf6' },
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

export const contacts: Contact[] = [
    { 
      id: 'contact-1', 
      workspace_id: 'ws-1',
      firstName: 'Carlos',
      lastName: 'Silva',
      name: 'Carlos Silva', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'carlos.silva@example.com', 
      phone: '+55 11 98765-4321', 
      lastSeen: '2 hours ago',
      businessProfile: {
        companyName: 'InnovateTech',
        website: 'innovatetech.com',
        industry: 'Software',
        employees: 50,
        dialogPriorityScore: 95,
        financialRiskScore: 10,
        deals: [
            { id: 'deal-1', name: 'Projeto Alpha', value: 'R$ 25.000', stage: 'Proposta Apresentada', closeDate: '30/08/2025' }
        ],
        tasks: [
            { id: 'task-1', description: 'Enviar contrato para João', dueDate: 'Vence Hoje', completed: false },
            { id: 'task-2', description: 'Ligar para o Sr. Roberto', dueDate: 'Agendado para 05/08', completed: false }
        ],
        tags: [mockTags[0], mockTags[1], mockTags[2]],
        customFields: {
            budget: 'R$ 50.000',
            product_interest: 'Software de Gestão',
        }
      }
    },
    { 
      id: 'contact-2', 
      workspace_id: 'ws-1',
      firstName: 'Beatriz',
      lastName: 'Costa',
      name: 'Beatriz Costa', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'beatriz.costa@example.com', 
      phone: '+55 21 91234-5678', 
      lastSeen: 'Online',
      businessProfile: {
        companyName: 'Soluções Criativas',
        website: 'solucoes.com',
        industry: 'Marketing',
        employees: 20,
        dialogPriorityScore: 30,
        financialRiskScore: 80,
        deals: [],
        tasks: [
             { id: 'task-3', description: 'Preparar apresentação de resultados', dueDate: 'Vence Amanhã', completed: false }
        ],
        tags: [],
        customFields: {}
      }
    },
    { 
      id: 'contact-3', 
      workspace_id: 'ws-1',
      firstName: 'Juliana',
      lastName: 'Almeida',
      name: 'Juliana Almeida', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'juliana.almeida@example.com', 
      phone: '+55 31 99999-8888', 
      lastSeen: 'Yesterday',
       businessProfile: {
        companyName: 'Logística Global',
        industry: 'Transporte',
        employees: 250,
        dialogPriorityScore: 65,
        financialRiskScore: 40,
        deals: [
             { id: 'deal-2', name: 'Expansão de Frota', value: 'R$ 150.000', stage: 'Negociação', closeDate: '15/09/2025' }
        ],
        tasks: [],
        tags: [mockTags[3]],
        customFields: {}
      }
    },
    { 
      id: 'contact-4', 
      workspace_id: 'ws-1',
      firstName: 'Ricardo',
      lastName: 'Pereira',
      name: 'Ricardo Pereira', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'ricardo.pereira@example.com', 
      phone: '+55 41 98888-7777', 
      lastSeen: '5 minutes ago',
      businessProfile: {
        companyName: 'RP Consultoria',
        industry: 'Consultoria',
        employees: 5,
        dialogPriorityScore: 80,
        financialRiskScore: 25,
        deals: [],
        tasks: [],
        tags: [],
        customFields: {}
      }
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
  {
    id: 'chat-3',
    workspace_id: 'ws-1',
    contact: contacts[2],
    status: 'gerais',
    messages: [
    ],
  },
  {
    id: 'chat-4',
    workspace_id: 'ws-1',
    contact: contacts[3],
    status: 'encerrados',
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


export const integrations: Integration[] = [
  { 
    id: 'nexusflow', 
    name: 'NexusFlow', 
    description: 'Controle fluxos de atendimento complexos e envie dados para webhooks externos através de um agente de automação.', 
    iconUrl: 'https://placehold.co/48x48.png', 
    tag: 'Automação', 
    tagType: 'primary', 
    status: 'active',
    href: '/integrations/nexusflow'
  },
  {
    id: 'evolution-api',
    name: 'Evolution API',
    description: 'Conecte seu número de WhatsApp para atendimento através da API não-oficial da Evolution.',
    iconUrl: 'https://placehold.co/48x48.png',
    tag: 'WhatsApp',
    tagType: 'primary',
    status: 'active',
    href: '/integrations/evolution-api'
  },
  {
    id: 'outras-integracoes',
    name: 'Outras Integrações',
    description: 'Em breve: conecte-se com outras ferramentas como RD Station, PipeDrive e muito mais.',
    iconUrl: 'https://placehold.co/48x48.png',
    tag: 'Em Breve',
    tagType: 'beta',
    status: 'coming_soon',
    additionalInfo: 'Planejado'
  }
];


export const nexusFlowInstances: NexusFlowInstance[] = [
  { 
    id: 'nfi-1', 
    name: 'Aviso de Instabilidade', 
    trigger: 'Cliente menciona que o sistema está "fora do ar", "lento" ou "instável".',
    action: 'Peço desculpas pelo transtorno. Estamos cientes de uma instabilidade temporária em nossos servidores e a equipe de engenharia já está trabalhando para normalizar o serviço o mais rápido possível.',
    enabled: true,
    model: 'googleai/gemini-2.0-flash',
  },
  { 
    id: 'nfi-2', 
    name: 'Dúvida sobre Fatura', 
    trigger: 'Cliente pergunta sobre a "fatura", "boleto" ou "pagamento".',
    action: 'Entendi. Para que eu possa ajudar com sua dúvida financeira, estou transferindo seu atendimento para um especialista do nosso time financeiro, ok?',
    enabled: true,
    model: 'googleai/gemini-2.0-flash',
  },
  { 
    id: 'nfi-3', 
    name: 'Cancelamento de Conta', 
    trigger: 'Cliente expressa o desejo de "cancelar a conta" ou "encerrar o serviço".',
    action: 'Lamento ouvir que você deseja cancelar. Antes de prosseguir, poderia me dizer o motivo? Seu feedback é muito importante para nós. Se preferir, posso transferir para um especialista que pode cuidar do processo de cancelamento para você.',
    enabled: false,
    model: 'googleai/gemini-2.0-flash',
  },
];

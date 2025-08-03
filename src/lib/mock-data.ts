import type { Chat, User, InternalChannel, InternalMessage } from './types';

export const agents: User[] = [
  { id: 'agent-1', firstName: 'Alex', lastName: 'Johnson', name: 'Alex Johnson', avatar: 'https://placehold.co/40x40.png', online: true, email: 'agent@dialogy.com' },
  { id: 'agent-2', firstName: 'Maria', lastName: 'Garcia', name: 'Maria Garcia', avatar: 'https://placehold.co/40x40.png', online: true, email: 'maria@dialogy.com' },
  { id: 'agent-3', firstName: 'David', lastName: 'Smith', name: 'David Smith', avatar: 'https://placehold.co/40x40.png', online: false, email: 'david@dialogy.com' },
  { id: 'agent-4', firstName: 'Sophia', lastName: 'Brown', name: 'Sophia Brown', avatar: 'https://placehold.co/40x40.png', online: true, email: 'sophia@dialogy.com' },
];

export const contacts: User[] = [
    { 
      id: 'contact-1', 
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
        deals: [
            { id: 'deal-1', name: 'Projeto Alpha', value: 'R$ 25.000', stage: 'Proposta Apresentada', closeDate: '30/08/2025' }
        ],
        tasks: [
            { id: 'task-1', description: 'Enviar contrato para João', dueDate: 'Vence Hoje', completed: false },
            { id: 'task-2', description: 'Ligar para o Sr. Roberto', dueDate: 'Agendado para 05/08', completed: false }
        ],
        tags: ['#HotLead', '#SaaS', '#PrecisaDeFollowUp']
      }
    },
    { 
      id: 'contact-2', 
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
        deals: [],
        tasks: [
             { id: 'task-3', description: 'Preparar apresentação de resultados', dueDate: 'Vence Amanhã', completed: false }
        ],
        tags: ['#ClienteAtivo', '#MarketingDigital']
      }
    },
    { 
      id: 'contact-3', 
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
        deals: [
             { id: 'deal-2', name: 'Expansão de Frota', value: 'R$ 150.000', stage: 'Negociação', closeDate: '15/09/2025' }
        ],
        tasks: [],
        tags: ['#Enterprise', '#Logística']
      }
    },
    { 
      id: 'contact-4', 
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
        deals: [],
        tasks: [],
        tags: ['#Consultoria', '#SMB']
      }
    },
];

export const chats: Chat[] = [
  {
    id: 'chat-1',
    contact: contacts[0],
    status: 'atendimentos',
    messages: [
      { id: 'msg-1-1', sender: contacts[0], content: "Olá, estou com uma dúvida sobre a proposta que recebi.", timestamp: '10:30 AM' },
      { id: 'msg-1-2', sender: agents[0], content: "Olá, Carlos. Claro, posso ajudar. Qual é a sua dúvida?", timestamp: '10:31 AM' },
    ],
  },
  {
    id: 'chat-2',
    contact: contacts[1],
    status: 'atendimentos',
    messages: [
      { id: 'msg-2-1', sender: contacts[1], content: "Gostaria de agendar a apresentação dos resultados da campanha.", timestamp: '11:05 AM' },
      { id: 'msg-2-2', sender: agents[1], content: "Com certeza, Beatriz. Qual o melhor dia e horário para você?", timestamp: '11:06 AM' },
    ],
  },
  {
    id: 'chat-3',
    contact: contacts[2],
    status: 'gerais',
    messages: [
      { id: 'msg-3-1', sender: contacts[2], content: "Preciso de um contato do departamento financeiro.", timestamp: '11:15 AM' },
    ],
  },
  {
    id: 'chat-4',
    contact: contacts[3],
    status: 'encerrados',
    messages: [
      { id: 'msg-4-1', sender: contacts[3], content: "Gostaria de agradecer pelo serviço.", timestamp: '09:00 AM' },
      { id: 'msg-4-2', sender: agents[0], content: "Nós que agradecemos, Ricardo! Estamos à disposição.", timestamp: '09:01 AM' },
      { id: 'msg-4-3', sender: contacts[3], content: "Obrigado!", timestamp: '09:02 AM' },
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

import type { Chat, User, InternalChannel, InternalMessage } from './types';

export const agents: User[] = [
  { id: 'agent-1', name: 'Alex Johnson', avatar: 'https://placehold.co/40x40.png', online: true, email: 'agent@connectisp.com' },
  { id: 'agent-2', name: 'Maria Garcia', avatar: 'https://placehold.co/40x40.png', online: true, email: 'maria@connectisp.com' },
  { id: 'agent-3', name: 'David Smith', avatar: 'https://placehold.co/40x40.png', online: false, email: 'david@connectisp.com' },
  { id: 'agent-4', name: 'Sophia Brown', avatar: 'https://placehold.co/40x40.png', online: true, email: 'sophia@connectisp.com' },
];

const contacts: User[] = [
    { 
      id: 'contact-1', 
      name: 'Carlos Silva', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'carlos.silva@example.com', 
      phone: '+55 11 98765-4321', 
      lastSeen: '2 hours ago',
      customerInfo: {
        contracts: [
          { contractId: 'CTR001', address: 'Residencial - Rua das Flores, 123', connectionStatus: 'Instável', currentPlan: 'Fibra Óptica 300 Mbps', dataUsage: { used: 280, total: 500, unit: 'GB' } },
          { contractId: 'CTR002', address: 'Comercial - Av. Principal, 456', connectionStatus: 'Online', currentPlan: 'Link Dedicado 100 Mbps', dataUsage: { used: 150, total: 1000, unit: 'GB' } }
        ],
        openInvoices: [ { id: 'FAT202500128', dueDate: '28/05/2025', amount: 'R$ 129,90', status: 'Vencida', url: '#' } ],
        technicalTickets: [ { id: 'TIC00789', date: '02/05/2025', subject: 'Sem conexão bairro X (Residencial)', status: 'Resolvido' } ]
      }
    },
    { 
      id: 'contact-2', 
      name: 'Beatriz Costa', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'beatriz.costa@example.com', 
      phone: '+55 21 91234-5678', 
      lastSeen: 'Online',
      customerInfo: {
        contracts: [
            { contractId: 'CTR003', address: 'Casa de Praia - Rua da Areia, 77', connectionStatus: 'Online', currentPlan: 'Fibra Óptica 100 Mbps', dataUsage: { used: 50, total: 200, unit: 'GB' } }
        ],
        openInvoices: [],
        technicalTickets: []
      }
    },
    { 
      id: 'contact-3', 
      name: 'Juliana Almeida', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'juliana.almeida@example.com', 
      phone: '+55 31 99999-8888', 
      lastSeen: 'Yesterday',
       customerInfo: {
        contracts: [
            { contractId: 'CTR004', address: 'Escritório Centro', connectionStatus: 'Offline', currentPlan: 'Fibra Óptica 500 Mbps', dataUsage: { used: 950, total: 1000, unit: 'GB' } }
        ],
        openInvoices: [
             { id: 'FAT202500130', dueDate: '20/06/2025', amount: 'R$ 249,90', status: 'Pendente', url: '#' },
             { id: 'FAT202500131', dueDate: '20/05/2025', amount: 'R$ 249,90', status: 'Vencida', url: '#' }
        ],
        technicalTickets: [
            { id: 'TIC00812', date: '15/05/2025', subject: 'Lentidão em horários de pico', status: 'Em análise' }
        ]
      }
    },
    { 
      id: 'contact-4', 
      name: 'Ricardo Pereira', 
      avatar: 'https://placehold.co/40x40.png', 
      email: 'ricardo.pereira@example.com', 
      phone: '+55 41 98888-7777', 
      lastSeen: '5 minutes ago',
      customerInfo: {
        contracts: [
            { contractId: 'CTR005', address: 'Apartamento', connectionStatus: 'Online', currentPlan: 'Fibra Óptica 200 Mbps', dataUsage: { used: 180, total: 200, unit: 'GB' } }
        ],
        openInvoices: [],
        technicalTickets: []
      }
    },
];

export const chats: Chat[] = [
  {
    id: 'chat-1',
    contact: contacts[0],
    status: 'atendimentos',
    messages: [
      { id: 'msg-1-1', sender: contacts[0], content: "Olá, estou com problemas na minha conexão com a internet.", timestamp: '10:30 AM' },
      { id: 'msg-1-2', sender: agents[0], content: "Olá, Carlos. Lamento ouvir isso. Pode me fornecer seu CPF para que eu possa verificar sua conta?", timestamp: '10:31 AM' },
    ],
  },
  {
    id: 'chat-2',
    contact: contacts[1],
    status: 'atendimentos',
    messages: [
      { id: 'msg-2-1', sender: contacts[1], content: "Meu roteador não está ligando.", timestamp: '11:05 AM' },
      { id: 'msg-2-2', sender: agents[1], content: "Entendido, Beatriz. Você já tentou conectá-lo a uma tomada diferente?", timestamp: '11:06 AM' },
      { id: 'msg-2-3', sender: contacts[1], content: "Sim, já tentei e nada.", timestamp: '11:07 AM' },
    ],
  },
  {
    id: 'chat-3',
    contact: contacts[2],
    status: 'gerais',
    messages: [
      { id: 'msg-3-1', sender: contacts[2], content: "Gostaria de saber mais sobre os novos planos de fibra ótica.", timestamp: '11:15 AM' },
    ],
  },
  {
    id: 'chat-4',
    contact: contacts[3],
    status: 'encerrados',
    messages: [
      { id: 'msg-4-1', sender: contacts[3], content: "Qual o horário de atendimento de vocês?", timestamp: '09:00 AM' },
      { id: 'msg-4-2', sender: agents[0], content: "Nosso horário de atendimento é das 8h às 22h, de segunda a sábado.", timestamp: '09:01 AM' },
      { id: 'msg-4-3', sender: contacts[3], content: "Ok, obrigado!", timestamp: '09:02 AM' },
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
      name: 'suporte-nivel-2',
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
    { id: 'imsg-1', channelId: 'channel-1', sender: agents[1], content: 'Alguém pode dar uma olhada no ticket #5821?', timestamp: '1:15 PM' },
    { id: 'imsg-2', channelId: 'channel-1', sender: agents[3], content: 'Claro, estou verificando agora.', timestamp: '1:16 PM' },
    { id: 'imsg-3', channelId: 'channel-1', sender: agents[1], content: 'Obrigada!', timestamp: '1:16 PM' },
    { id: 'imsg-4', channelId: 'dm-1', sender: agents[1], content: 'Oi Alex, você está livre para uma rápida chamada?', timestamp: '2:30 PM' },
    { id: 'imsg-5', channelId: 'dm-1', sender: agents[0], content: 'Sim, me liga em 5 minutos.', timestamp: '2:31 PM' },
];

export const getContactById = (id: string) => contacts.find(c => c.id === id);

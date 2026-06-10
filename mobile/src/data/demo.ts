import type { InboxBootstrap } from "@/types";

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

export const demoBootstrap: InboxBootstrap = {
  user: {
    id: "demo-user",
    name: "Fabricio",
    email: "fabricio@dialogy.local",
    workspaceId: "demo-workspace",
    workspaceName: "Dialogy Operacao"
  },
  chats: [
    {
      id: "chat-whatsapp-sgp",
      contact: {
        id: "contact-sgp",
        name: "Cliente SGP",
        initials: "CS",
        channel: "whatsapp",
        phone: "+55 11 99999-8877"
      },
      status: "gerais",
      lastMessage: "Preciso da 2a via e do PIX da fatura.",
      lastMessageAt: minutesAgo(2),
      unreadCount: 2,
      tags: ["Novo", "Financeiro"],
      isAiActive: true
    },
    {
      id: "chat-messenger-lead",
      contact: {
        id: "contact-lead",
        name: "Lead Messenger",
        initials: "LM",
        channel: "messenger"
      },
      status: "gerais",
      lastMessage: "Quero falar com vendas sobre automacao.",
      lastMessageAt: minutesAgo(7),
      unreadCount: 1,
      tags: ["Lead", "Comercial"]
    },
    {
      id: "chat-telegram-suporte",
      contact: {
        id: "contact-telegram",
        name: "Suporte Telegram",
        initials: "ST",
        channel: "telegram"
      },
      status: "atendimentos",
      lastMessage: "Meu chamado ainda esta aberto?",
      lastMessageAt: minutesAgo(14),
      unreadCount: 1,
      tags: ["Suporte"],
      assignedTo: "Fabricio"
    },
    {
      id: "chat-whatsapp-cliente",
      contact: {
        id: "contact-whatsapp",
        name: "Cliente WhatsApp",
        initials: "CW",
        channel: "whatsapp"
      },
      status: "atendimentos",
      lastMessage: "Pode me mandar o comprovante?",
      lastMessageAt: minutesAgo(31),
      unreadCount: 0,
      tags: ["Fila"],
      assignedTo: "Fabricio"
    }
  ],
  messagesByChatId: {
    "chat-whatsapp-sgp": [
      {
        id: "m1",
        chatId: "chat-whatsapp-sgp",
        content: "Bom dia, preciso da 2a via da minha fatura.",
        createdAt: minutesAgo(5),
        fromMe: false,
        channel: "whatsapp",
        status: "read"
      },
      {
        id: "m2",
        chatId: "chat-whatsapp-sgp",
        content: "Tambem queria pagar por PIX.",
        createdAt: minutesAgo(2),
        fromMe: false,
        channel: "whatsapp",
        status: "delivered"
      }
    ],
    "chat-messenger-lead": [
      {
        id: "m3",
        chatId: "chat-messenger-lead",
        content: "Vi o anuncio e quero falar com vendas sobre automacao.",
        createdAt: minutesAgo(7),
        fromMe: false,
        channel: "messenger",
        status: "read"
      },
      {
        id: "m4",
        chatId: "chat-messenger-lead",
        content: "Recebido. Vou te direcionar para o time comercial.",
        createdAt: minutesAgo(6),
        fromMe: true,
        channel: "messenger",
        status: "delivered"
      }
    ],
    "chat-telegram-suporte": [
      {
        id: "m5",
        chatId: "chat-telegram-suporte",
        content: "Meu chamado ainda esta aberto?",
        createdAt: minutesAgo(14),
        fromMe: false,
        channel: "telegram",
        status: "read"
      },
      {
        id: "m6",
        chatId: "chat-telegram-suporte",
        content: "Sim. Localizei o atendimento e vou te atualizar.",
        createdAt: minutesAgo(13),
        fromMe: true,
        channel: "telegram",
        status: "sent"
      }
    ],
    "chat-whatsapp-cliente": [
      {
        id: "m7",
        chatId: "chat-whatsapp-cliente",
        content: "Pode me mandar o comprovante?",
        createdAt: minutesAgo(31),
        fromMe: false,
        channel: "whatsapp",
        status: "read"
      },
      {
        id: "m8",
        chatId: "chat-whatsapp-cliente",
        content: "Posso sim. Vou anexar o documento na conversa.",
        createdAt: minutesAgo(29),
        fromMe: true,
        channel: "whatsapp",
        status: "read"
      }
    ]
  }
};

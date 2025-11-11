
import type { Integration } from './types';

export const availableIntegrations: Integration[] = [
    {
        id: 'evolution-api',
        name: "Evolution API",
        description: "Gerencie as instâncias de WhatsApp (não-oficial) para conectar seus números.",
        iconUrl: "https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/public/icon.png",
        tag: "WhatsApp",
        tagType: "primary",
        href: "/integrations/evolution-api",
        status: 'active'
    },
    {
        id: 'dialogflow',
        name: "Google Dialogflow",
        description: "Conecte agentes de IA avançados do Dialogflow para automatizar conversas.",
        iconUrl: "https://www.gstatic.com/dialogflow-console/common/assets/img/logo-mobile.png",
        tag: "IA",
        tagType: "secondary",
        href: "#",
        status: 'coming_soon'
    },
    {
        id: 'stripe',
        name: "Stripe",
        description: "Integre pagamentos e cobranças diretamente nas suas conversas.",
        iconUrl: "https://stripe.com/img/v3/home/twitter.png",
        tag: "Pagamentos",
        tagType: "beta",
        href: "#",
        status: 'coming_soon'
    }
];

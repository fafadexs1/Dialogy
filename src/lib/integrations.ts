
import type { Integration } from './types';

// This file serves as a fallback or for initial seeding.
// The primary source of truth for integrations should be the database.
export const availableIntegrations: Integration[] = [
    {
        id: 'evolution-api',
        name: "Evolution API",
        description: "Gerencie as instâncias de WhatsApp (não-oficial) para conectar seus números.",
        icon_url: "https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/public/icon.png",
        tag: "WhatsApp",
        tag_type: "primary",
        href: "/integrations/evolution-api",
        status: 'active'
    },
    {
        id: 'dialogflow',
        name: "Google Dialogflow",
        description: "Conecte agentes de IA avançados do Dialogflow para automatizar conversas.",
        icon_url: "https://www.gstatic.com/dialogflow-console/common/assets/img/logo-mobile.png",
        tag: "IA",
        tag_type: "secondary",
        href: "#",
        status: 'coming_soon'
    },
    {
        id: 'stripe',
        name: "Stripe",
        description: "Integre pagamentos e cobranças diretamente nas suas conversas.",
        icon_url: "https://stripe.com/img/v3/home/twitter.png",
        tag: "Pagamentos",
        tag_type: "beta",
        href: "#",
        status: 'coming_soon'
    },
    {
        id: 'meta-instagram',
        name: "Instagram Direct (Oficial)",
        description: "Receba e envie mensagens do Instagram com webhooks e Graph API.",
        icon_url: "https://static-00.iconduck.com/assets.00/instagram-icon-256x256-gxth2yqu.png",
        tag: "Instagram",
        tag_type: "primary",
        href: "/integrations/meta-instagram",
        status: 'active'
    },
    {
        id: 'meta-messenger',
        name: "Facebook Messenger (Oficial)",
        description: "Atenda clientes do Messenger com webhooks oficiais e Graph API.",
        icon_url: "https://static-00.iconduck.com/assets.00/messenger-icon-256x256-fjxn4yz0.png",
        tag: "Messenger",
        tag_type: "primary",
        href: "/integrations/meta-messenger",
        status: 'active'
    },
    {
        id: 'sgp',
        name: "SGP",
        description: "Plugin de integração com o sistema SGP.",
        icon_url: "https://raichu-uploads.s3.amazonaws.com/logo_tsmx_G0fUrW.png",
        tag: "SGP",
        tag_type: "beta",
        href: "/integrations/sgp",
        status: 'active'
    }
];

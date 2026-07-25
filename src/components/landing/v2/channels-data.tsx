import type { IconType } from 'react-icons';
import {
    FaWhatsapp,
    FaInstagram,
    FaFacebookMessenger,
    FaTelegram,
} from 'react-icons/fa6';
import { Globe, ShoppingBag, Bike } from 'lucide-react';

export type Channel = {
    id: string;
    name: string;
    tagline: string;
    /** Brand colour, used as the icon tile fill. */
    color: string;
    /** Very light tint of the same hue for the card hover state. */
    tint: string;
    Icon: IconType | React.ComponentType<{ className?: string }>;
    badge?: string;
};

export const CHANNELS: Channel[] = [
    {
        id: 'whatsapp',
        name: 'WhatsApp',
        tagline: 'QR Code ou API Oficial da Meta, com múltiplos números na mesma operação.',
        color: 'bg-[#25D366]',
        tint: 'hover:bg-[#25D366]/[0.06]',
        Icon: FaWhatsapp,
        badge: 'API Oficial',
    },
    {
        id: 'instagram',
        name: 'Instagram Direct',
        tagline: 'Responda DMs e comentários do seu perfil sem sair do inbox.',
        color: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]',
        tint: 'hover:bg-[#DD2A7B]/[0.05]',
        Icon: FaInstagram,
    },
    {
        id: 'messenger',
        name: 'Facebook Messenger',
        tagline: 'Toda conversa da sua página do Facebook cai na mesma fila do time.',
        color: 'bg-gradient-to-br from-[#00B2FF] to-[#006AFF]',
        tint: 'hover:bg-[#006AFF]/[0.05]',
        Icon: FaFacebookMessenger,
    },
    {
        id: 'site',
        name: 'Chat no seu site',
        tagline: 'Um widget que você cola no site e sai capturando lead na hora.',
        color: 'bg-gradient-to-br from-violet-500 to-indigo-600',
        tint: 'hover:bg-violet-500/[0.05]',
        Icon: Globe,
        badge: '1 linha de código',
    },
    {
        id: 'telegram',
        name: 'Telegram',
        tagline: 'Comunidades e suporte técnico atendidos junto com os outros canais.',
        color: 'bg-gradient-to-br from-[#37AEE2] to-[#1E96C8]',
        tint: 'hover:bg-[#37AEE2]/[0.05]',
        Icon: FaTelegram,
    },
    {
        id: 'marketplace',
        name: 'Mercado Livre',
        tagline: 'Perguntas e mensagens de pedidos direto no mesmo painel.',
        color: 'bg-gradient-to-br from-[#FFE600] to-[#FFB800]',
        tint: 'hover:bg-[#FFE600]/[0.08]',
        Icon: ShoppingBag,
    },
    {
        id: 'delivery',
        name: 'Delivery Hub',
        tagline: 'Cardápio, pedido e status de entrega dentro da conversa.',
        color: 'bg-gradient-to-br from-rose-500 to-orange-500',
        tint: 'hover:bg-rose-500/[0.05]',
        Icon: Bike,
    },
];

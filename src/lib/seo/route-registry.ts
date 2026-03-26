import type { MetadataRoute } from 'next';

import {
    HOME_SEO_DESCRIPTION,
    HOME_SEO_KEYWORDS,
    HOME_SEO_TITLE,
} from '@/content/home-seo';

export type PublicSeoRoute = {
    pathname: string;
    title: string;
    description: string;
    keywords: string[];
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
    index: boolean;
    ogType?: 'website' | 'article' | 'profile';
};

export const PUBLIC_SEO_ROUTES: PublicSeoRoute[] = [
    {
        pathname: '/',
        title: HOME_SEO_TITLE,
        description: HOME_SEO_DESCRIPTION,
        keywords: HOME_SEO_KEYWORDS,
        priority: 1,
        changeFrequency: 'weekly',
        index: true,
        ogType: 'website',
    },
    {
        pathname: '/about',
        title: 'Sobre a Dialogy',
        description: 'Conheca a Dialogy, a plataforma focada em CRM conversacional, atendimento omnichannel e automacao com IA para empresas no Brasil.',
        keywords: ['sobre a Dialogy', 'empresa de CRM conversacional', 'automacao com IA'],
        priority: 0.7,
        changeFrequency: 'monthly',
        index: true,
        ogType: 'website',
    },
    {
        pathname: '/pricing',
        title: 'Precos do CRM para WhatsApp e omnichannel',
        description: 'Compare os planos da Dialogy com usuarios ilimitados, limite por chats, canais conectados e teste gratis de 7 dias.',
        keywords: ['preco CRM WhatsApp', 'planos omnichannel', 'teste gratis CRM atendimento'],
        priority: 0.95,
        changeFrequency: 'weekly',
        index: true,
        ogType: 'website',
    },
    {
        pathname: '/privacy',
        title: 'Politica de Privacidade',
        description: 'Leia a politica de privacidade da Dialogy e entenda como tratamos dados, seguranca, LGPD e informacoes da plataforma.',
        keywords: ['politica de privacidade Dialogy', 'LGPD Dialogy'],
        priority: 0.3,
        changeFrequency: 'yearly',
        index: true,
        ogType: 'article',
    },
    {
        pathname: '/terms',
        title: 'Termos de Uso',
        description: 'Consulte os termos de uso da Dialogy, incluindo regras de utilizacao, licenca, uso aceitavel e responsabilidades.',
        keywords: ['termos de uso Dialogy', 'contrato plataforma atendimento'],
        priority: 0.3,
        changeFrequency: 'yearly',
        index: true,
        ogType: 'article',
    },
    {
        pathname: '/developer',
        title: 'Portal do Desenvolvedor',
        description: 'Explore documentacao, APIs, SDKs e guias para integrar a Dialogy em experiencias conversacionais, automacoes e fluxos customizados.',
        keywords: ['API Dialogy', 'documentacao Dialogy', 'SDK atendimento omnichannel'],
        priority: 0.85,
        changeFrequency: 'weekly',
        index: true,
        ogType: 'website',
    },
    {
        pathname: '/developer/docs',
        title: 'Documentacao',
        description: 'Guias tecnicos da Dialogy para autenticacao, webhooks, arquitetura, filas e integracoes.',
        keywords: ['documentacao API', 'webhooks Dialogy', 'guia tecnico omnichannel'],
        priority: 0.8,
        changeFrequency: 'weekly',
        index: true,
        ogType: 'article',
    },
    {
        pathname: '/developer/docs/architecture',
        title: 'Arquitetura da Plataforma',
        description: 'Entenda a arquitetura da Dialogy para atendimento omnichannel, automacoes, server actions e processamento de mensagens.',
        keywords: ['arquitetura Dialogy', 'arquitetura atendimento omnichannel'],
        priority: 0.7,
        changeFrequency: 'monthly',
        index: true,
        ogType: 'article',
    },
    {
        pathname: '/developer/docs/load-balancing',
        title: 'Load Balancing e Distribuicao',
        description: 'Aprenda como a Dialogy distribui chats, presenca e balanceamento para operacoes de atendimento em escala.',
        keywords: ['load balancing chat', 'distribuicao de atendimento'],
        priority: 0.65,
        changeFrequency: 'monthly',
        index: true,
        ogType: 'article',
    },
    {
        pathname: '/developer/api',
        title: 'Referencia da API',
        description: 'Consulte a referencia da API da Dialogy para integrar mensagens, canais, automacoes e recursos de atendimento.',
        keywords: ['referencia API Dialogy', 'API mensagens'],
        priority: 0.75,
        changeFrequency: 'weekly',
        index: true,
        ogType: 'article',
    },
    {
        pathname: '/developer/community',
        title: 'Comunidade',
        description: 'Participe da comunidade de desenvolvedores da Dialogy para acompanhar novidades, integracoes e boas praticas.',
        keywords: ['comunidade Dialogy', 'desenvolvedores Dialogy'],
        priority: 0.55,
        changeFrequency: 'monthly',
        index: true,
        ogType: 'website',
    },
    {
        pathname: '/developer/sdks',
        title: 'SDKs e Bibliotecas',
        description: 'Veja os SDKs e bibliotecas da Dialogy para acelerar integracoes com sua operacao omnichannel.',
        keywords: ['SDK Dialogy', 'biblioteca API atendimento'],
        priority: 0.7,
        changeFrequency: 'weekly',
        index: true,
        ogType: 'article',
    },
    {
        pathname: '/creators',
        title: 'Criadores da Dialogy',
        description: 'Conheca os criadores e liderancas por tras da Dialogy, sua visao de produto e a estrategia da plataforma.',
        keywords: ['criadores Dialogy', 'equipe Dialogy'],
        priority: 0.45,
        changeFrequency: 'monthly',
        index: true,
        ogType: 'profile',
    },
];

export function getPublicSeoRoute(pathname: string): PublicSeoRoute | undefined {
    return PUBLIC_SEO_ROUTES.find((route) => route.pathname === pathname);
}

export function getIndexablePublicSeoRoutes(): PublicSeoRoute[] {
    return PUBLIC_SEO_ROUTES.filter((route) => route.index);
}

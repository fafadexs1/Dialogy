import { HOME_FAQ_ITEMS } from './home-seo';

type SeedRoute = {
    pathname: string;
    title: string;
    description: string;
    canonical: string;
    robots: 'index, follow' | 'noindex, nofollow';
    ogImage: string;
    ogType: 'website' | 'article' | 'profile';
    jsonLd: string;
};

const UPDATED_AT = '2026-03-26';

export const GLOBAL_SEO_DB_DEFAULTS = {
    siteName: 'Dialogy',
    slogan: 'CRM para WhatsApp, omnichannel e IA para vendas e suporte.',
    titleTemplate: '%s | Dialogy',
    description: 'CRM para WhatsApp com inbox omnichannel, automacao de atendimento, IA para qualificar leads e analytics para vendas e suporte em escala.',
    faviconUrl: '/favicon.ico',
    logoUrl: '/logo.png',
    defaultOgImage: '/logo-new.jpg',
    themeColor: '#ffffff',
    twitterHandle: '',
};

function buildWebsite(baseUrl: string) {
    return {
        '@type': 'WebSite',
        name: 'Dialogy',
        url: baseUrl,
    };
}

function buildOrganization(baseUrl: string) {
    return {
        '@type': 'Organization',
        name: 'Dialogy',
        url: baseUrl,
        logo: `${baseUrl}/logo.png`,
    };
}

function buildBreadcrumb(baseUrl: string, items: Array<{ name: string; path: string }>) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: `${baseUrl}${item.path}`,
        })),
    };
}

function buildPageEntity({
    type,
    title,
    description,
    url,
    image,
    baseUrl,
}: {
    type: string;
    title: string;
    description: string;
    url: string;
    image: string;
    baseUrl: string;
}) {
    return {
        '@context': 'https://schema.org',
        '@type': type,
        name: title,
        headline: title,
        description,
        url,
        inLanguage: 'pt-BR',
        image: [image],
        isPartOf: buildWebsite(baseUrl),
        publisher: buildOrganization(baseUrl),
        dateModified: UPDATED_AT,
    };
}

function buildHomeFaqSchema() {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: HOME_FAQ_ITEMS.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer,
            },
        })),
    };
}

export function getPublicSeoDbDefaults(baseUrl: string): SeedRoute[] {
    const ogImage = `${baseUrl}/logo-new.jpg`;

    const routes: Array<Omit<SeedRoute, 'canonical' | 'ogImage' | 'jsonLd'>> = [
        {
            pathname: '/',
            title: 'CRM para WhatsApp e atendimento omnichannel com IA',
            description: 'CRM para WhatsApp com inbox omnichannel, automacao de atendimento, IA para qualificar leads e analytics para vendas e suporte em escala.',
            robots: 'index, follow',
            ogType: 'website',
        },
        {
            pathname: '/about',
            title: 'Sobre a Dialogy',
            description: 'Conheca a Dialogy, a plataforma focada em CRM conversacional, atendimento omnichannel e automacao com IA para empresas no Brasil.',
            robots: 'index, follow',
            ogType: 'website',
        },
        {
            pathname: '/pricing',
            title: 'Precos do CRM para WhatsApp e omnichannel',
            description: 'Compare os planos da Dialogy com usuarios ilimitados, limite por chats, canais conectados e teste gratis de 7 dias.',
            robots: 'index, follow',
            ogType: 'website',
        },
        {
            pathname: '/privacy',
            title: 'Politica de Privacidade',
            description: 'Leia a politica de privacidade da Dialogy e entenda como tratamos dados, seguranca, LGPD e informacoes da plataforma.',
            robots: 'index, follow',
            ogType: 'article',
        },
        {
            pathname: '/terms',
            title: 'Termos de Uso',
            description: 'Consulte os termos de uso da Dialogy, incluindo regras de utilizacao, licenca, uso aceitavel e responsabilidades.',
            robots: 'index, follow',
            ogType: 'article',
        },
        {
            pathname: '/developer',
            title: 'Portal do Desenvolvedor',
            description: 'Explore documentacao, APIs, SDKs e guias para integrar a Dialogy em experiencias conversacionais, automacoes e fluxos customizados.',
            robots: 'index, follow',
            ogType: 'website',
        },
        {
            pathname: '/developer/docs',
            title: 'Documentacao',
            description: 'Guias tecnicos da Dialogy para autenticacao, webhooks, arquitetura, filas e integracoes.',
            robots: 'index, follow',
            ogType: 'article',
        },
        {
            pathname: '/developer/docs/architecture',
            title: 'Arquitetura da Plataforma',
            description: 'Entenda a arquitetura da Dialogy para atendimento omnichannel, automacoes, server actions e processamento de mensagens.',
            robots: 'index, follow',
            ogType: 'article',
        },
        {
            pathname: '/developer/docs/load-balancing',
            title: 'Load Balancing e Distribuicao',
            description: 'Aprenda como a Dialogy distribui chats, presenca e balanceamento para operacoes de atendimento em escala.',
            robots: 'index, follow',
            ogType: 'article',
        },
        {
            pathname: '/developer/api',
            title: 'Referencia da API',
            description: 'Consulte a referencia da API da Dialogy para integrar mensagens, canais, automacoes e recursos de atendimento.',
            robots: 'index, follow',
            ogType: 'article',
        },
        {
            pathname: '/developer/community',
            title: 'Comunidade',
            description: 'Participe da comunidade de desenvolvedores da Dialogy para acompanhar novidades, integracoes e boas praticas.',
            robots: 'index, follow',
            ogType: 'website',
        },
        {
            pathname: '/developer/sdks',
            title: 'SDKs e Bibliotecas',
            description: 'Veja os SDKs e bibliotecas da Dialogy para acelerar integracoes com sua operacao omnichannel.',
            robots: 'index, follow',
            ogType: 'article',
        },
        {
            pathname: '/creators',
            title: 'Criadores da Dialogy',
            description: 'Conheca os criadores e liderancas por tras da Dialogy, sua visao de produto e a estrategia da plataforma.',
            robots: 'index, follow',
            ogType: 'profile',
        },
    ];

    return routes.map((route) => {
        const canonical = `${baseUrl}${route.pathname}`;
        const breadcrumbItems = [
            { name: 'Home', path: '/' },
            ...(route.pathname.startsWith('/developer') ? [{ name: 'Developer', path: '/developer' }] : []),
            ...(route.pathname === '/developer' ? [] : [{ name: route.title, path: route.pathname }]),
        ];

        let schemas: Array<Record<string, unknown>> = [];

        switch (route.pathname) {
            case '/':
                schemas = [
                    buildPageEntity({
                        type: 'WebPage',
                        title: route.title,
                        description: route.description,
                        url: canonical,
                        image: ogImage,
                        baseUrl,
                    }),
                    buildHomeFaqSchema(),
                ];
                break;
            case '/about':
                schemas = [
                    buildPageEntity({
                        type: 'AboutPage',
                        title: route.title,
                        description: route.description,
                        url: canonical,
                        image: ogImage,
                        baseUrl,
                    }),
                ];
                break;
            case '/pricing':
                schemas = [
                    buildPageEntity({
                        type: 'CollectionPage',
                        title: route.title,
                        description: route.description,
                        url: canonical,
                        image: ogImage,
                        baseUrl,
                    }),
                    {
                        '@context': 'https://schema.org',
                        '@type': 'OfferCatalog',
                        name: 'Planos Dialogy',
                        url: canonical,
                        itemListElement: [
                            {
                                '@type': 'Offer',
                                name: 'Dialogy com usuarios ilimitados',
                                description: 'Plano com limite por chats, canais conectados e teste gratis de 7 dias.',
                                priceCurrency: 'BRL',
                                availability: 'https://schema.org/InStock',
                            },
                        ],
                    },
                ];
                break;
            case '/privacy':
            case '/terms':
                schemas = [
                    buildPageEntity({
                        type: 'WebPage',
                        title: route.title,
                        description: route.description,
                        url: canonical,
                        image: ogImage,
                        baseUrl,
                    }),
                ];
                break;
            case '/developer':
                schemas = [
                    buildPageEntity({
                        type: 'CollectionPage',
                        title: route.title,
                        description: route.description,
                        url: canonical,
                        image: ogImage,
                        baseUrl,
                    }),
                ];
                break;
            case '/creators':
                schemas = [
                    {
                        ...buildPageEntity({
                            type: 'ProfilePage',
                            title: route.title,
                            description: route.description,
                            url: canonical,
                            image: ogImage,
                            baseUrl,
                        }),
                        mainEntity: buildOrganization(baseUrl),
                    },
                ];
                break;
            default:
                schemas = [
                    buildPageEntity({
                        type: route.ogType === 'article' ? 'TechArticle' : 'WebPage',
                        title: route.title,
                        description: route.description,
                        url: canonical,
                        image: ogImage,
                        baseUrl,
                    }),
                    buildBreadcrumb(baseUrl, [
                        ...breadcrumbItems,
                    ]),
                ];
                break;
        }

        return {
            ...route,
            canonical,
            ogImage,
            jsonLd: JSON.stringify(schemas),
        };
    });
}

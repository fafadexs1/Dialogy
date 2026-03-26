import { absoluteUrl, getSeoSiteContext } from './metadata';

type JsonLdProps = {
    id?: string;
    data: Record<string, unknown> | Array<Record<string, unknown>>;
};

type BreadcrumbItem = {
    name: string;
    path: string;
};

type FaqItem = {
    question: string;
    answer: string;
};

type SoftwareApplicationOptions = {
    path?: string;
    description?: string;
    category?: string;
};

export function JsonLd({ id, data }: JsonLdProps) {
    return (
        <script
            id={id}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
    );
}

export async function getOrganizationSchema() {
    const site = await getSeoSiteContext();

    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: site.siteName,
        url: site.baseUrl,
        slogan: site.slogan,
        logo: site.logoUrl || site.defaultOgImage,
    };
}

export async function getWebSiteSchema() {
    const site = await getSeoSiteContext();

    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.siteName,
        url: site.baseUrl,
        description: site.description,
    };
}

export async function getSoftwareApplicationSchema(options: SoftwareApplicationOptions = {}) {
    const site = await getSeoSiteContext();

    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: site.siteName,
        applicationCategory: options.category || 'BusinessApplication',
        operatingSystem: 'Web',
        url: absoluteUrl(options.path || '/', site.baseUrl),
        description: options.description || site.description,
    };
}

export function getBreadcrumbSchema(items: BreadcrumbItem[]) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: absoluteUrl(item.path),
        })),
    };
}

export function getFaqSchema(items: FaqItem[]) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer,
            },
        })),
    };
}

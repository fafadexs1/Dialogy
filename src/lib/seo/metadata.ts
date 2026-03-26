import type { Metadata } from 'next';

import { seoStore } from '@/services/seo-store';
import { globalSeoStore } from '@/services/global-seo-store';

import { getRobotsDirectives } from './indexability';
import { getPublicSeoRoute } from './route-registry';

const DEFAULT_SITE_NAME = 'Dialogy';
const DEFAULT_DESCRIPTION = 'Centralize WhatsApp, Instagram e outros canais em uma operacao omnichannel com automacao, IA e visibilidade comercial.';

type PageMetadataOverrides = {
    pathname: string;
    title?: string;
    description?: string;
    keywords?: string[];
    canonicalPath?: string;
    image?: string;
    noindex?: boolean;
    ogType?: 'website' | 'article' | 'profile';
};

export type SeoSiteContext = {
    siteName: string;
    titleTemplate: string;
    description: string;
    slogan?: string;
    baseUrl: string;
    metadataBase: URL;
    faviconUrl?: string;
    logoUrl?: string;
    defaultOgImage?: string;
    twitterHandle?: string;
    themeColor?: string;
    iconVersion: number;
};

function resolveNonEmpty(value: string | undefined | null, fallback: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : fallback;
}

function getBaseUrl() {
    return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function normalizeUrl(value: string | undefined, baseUrl: string) {
    if (!value) {
        return undefined;
    }

    if (/^https?:\/\//i.test(value)) {
        return value;
    }

    return value.startsWith('/') ? `${baseUrl}${value}` : `${baseUrl}/${value}`;
}

function parseRobots(robots?: string) {
    if (!robots) {
        return undefined;
    }

    const normalized = robots.toLowerCase();
    return {
        index: normalized.includes('index') && !normalized.includes('noindex'),
        follow: normalized.includes('follow') && !normalized.includes('nofollow'),
    };
}

export async function getSeoSiteContext(): Promise<SeoSiteContext> {
    const { settings, updatedAt } = await globalSeoStore.getWithMeta();
    const baseUrl = getBaseUrl();
    const iconVersion = updatedAt ? new Date(updatedAt).getTime() : 0;
    const siteName = resolveNonEmpty(settings.siteName, DEFAULT_SITE_NAME);
    const description = resolveNonEmpty(settings.description, DEFAULT_DESCRIPTION);
    const titleTemplate = settings.titleTemplate?.includes('%s')
        ? resolveNonEmpty(settings.titleTemplate, `%s | ${siteName}`)
        : `%s | ${siteName}`;

    return {
        siteName,
        titleTemplate,
        description,
        slogan: settings.slogan?.trim() || undefined,
        baseUrl,
        metadataBase: new URL(baseUrl),
        faviconUrl: normalizeUrl(settings.faviconUrl || undefined, baseUrl),
        logoUrl: normalizeUrl(settings.logoUrl || undefined, baseUrl),
        defaultOgImage: normalizeUrl(settings.defaultOgImage || undefined, baseUrl),
        twitterHandle: settings.twitterHandle || undefined,
        themeColor: settings.themeColor?.trim() || '#09090b',
        iconVersion,
    };
}

export function absoluteUrl(pathOrUrl: string, baseUrl = getBaseUrl()) {
    if (/^https?:\/\//i.test(pathOrUrl)) {
        return pathOrUrl;
    }

    return pathOrUrl.startsWith('/') ? `${baseUrl}${pathOrUrl}` : `${baseUrl}/${pathOrUrl}`;
}

export async function buildRootMetadata(): Promise<Metadata> {
    const site = await getSeoSiteContext();
    const fallbackIcon = `${site.baseUrl}/api/favicon?v=${site.iconVersion}`;
    const baseIconUrl = site.faviconUrl || fallbackIcon;
    const getIconType = (url: string) => {
        const ext = url.split('.').pop()?.toLowerCase();
        if (ext === 'png') return 'image/png';
        if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
        if (ext === 'svg') return 'image/svg+xml';
        if (ext === 'ico') return 'image/x-icon';
        return undefined;
    };
    const iconSeparator = baseIconUrl.includes('?') ? '&' : '?';
    const versionedIcon = `${baseIconUrl}${iconSeparator}v=${site.iconVersion}`;
    const icon = { url: versionedIcon, type: getIconType(baseIconUrl) };

    return {
        metadataBase: site.metadataBase,
        applicationName: site.siteName,
        title: {
            default: site.siteName,
            template: site.titleTemplate,
        },
        description: site.description,
        alternates: {
            canonical: site.baseUrl,
        },
        icons: [
            { rel: 'icon', ...icon },
            { rel: 'shortcut icon', ...icon },
            ...(site.faviconUrl ? [{ rel: 'apple-touch-icon', ...icon }] : []),
        ],
        openGraph: {
            type: 'website',
            url: site.baseUrl,
            siteName: site.siteName,
            title: site.siteName,
            description: site.description,
            images: site.defaultOgImage ? [{ url: site.defaultOgImage }] : undefined,
        },
        twitter: {
            card: 'summary_large_image',
            site: site.twitterHandle,
            creator: site.twitterHandle,
            title: site.siteName,
            description: site.description,
            images: site.defaultOgImage ? [site.defaultOgImage] : undefined,
        },
        other: {
            'theme-color': site.themeColor || '#09090b',
        },
        manifest: '/manifest.json',
        appleWebApp: {
            capable: true,
            statusBarStyle: 'default',
            title: site.siteName,
        },
        formatDetection: {
            telephone: false,
        },
    };
}

export async function buildPageMetadata({
    pathname,
    title,
    description,
    keywords,
    canonicalPath,
    image,
    noindex,
    ogType,
}: PageMetadataOverrides): Promise<Metadata> {
    const [site, entry] = await Promise.all([
        getSeoSiteContext(),
        seoStore.getByPath(pathname).catch(() => undefined),
    ]);
    const route = getPublicSeoRoute(pathname);
    const resolvedTitle = title || entry?.title || route?.title || site.siteName;
    const resolvedDescription = description || entry?.description || route?.description || site.description;
    const resolvedKeywords = keywords || route?.keywords;
    const robotsFromStore = parseRobots(entry?.robots);
    const routeRobots = getRobotsDirectives(pathname);
    const resolvedNoindex = typeof noindex === 'boolean' ? noindex : robotsFromStore ? !robotsFromStore.index : !routeRobots.index;
    const resolvedRobots = {
        index: !resolvedNoindex,
        follow: !resolvedNoindex,
    };
    const resolvedCanonical = absoluteUrl(canonicalPath || entry?.canonical || pathname, site.baseUrl);
    const resolvedImage = normalizeUrl(image || entry?.ogImage || site.defaultOgImage, site.baseUrl);
    const resolvedOgType = ogType || (entry?.ogType as 'website' | 'article' | 'profile' | undefined) || route?.ogType || 'website';

    return {
        title: pathname === '/' ? { absolute: resolvedTitle } : resolvedTitle,
        description: resolvedDescription,
        keywords: resolvedKeywords,
        robots: resolvedRobots,
        alternates: {
            canonical: resolvedCanonical,
        },
        openGraph: {
            type: resolvedOgType,
            url: resolvedCanonical,
            siteName: site.siteName,
            title: resolvedTitle,
            description: resolvedDescription,
            images: resolvedImage ? [{ url: resolvedImage }] : undefined,
        },
        twitter: {
            card: resolvedImage ? 'summary_large_image' : 'summary',
            site: site.twitterHandle,
            creator: site.twitterHandle,
            title: resolvedTitle,
            description: resolvedDescription,
            images: resolvedImage ? [resolvedImage] : undefined,
        },
    };
}

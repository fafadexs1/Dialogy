import { getPublicSeoRoute } from './route-registry';

const NOINDEX_EXACT_PATHS = new Set([
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/setup',
]);

const NOINDEX_PREFIXES = [
    '/analytics',
    '/api',
    '/automations',
    '/autopilot',
    '/campaigns',
    '/crm',
    '/inbox',
    '/integrations',
    '/internal',
    '/join',
    '/nexus',
    '/r',
    '/referrals',
    '/settings',
    '/superadmin',
    '/support',
    '/team',
];

export function isIndexablePath(pathname: string): boolean {
    const route = getPublicSeoRoute(pathname);
    if (route) {
        return route.index;
    }

    if (NOINDEX_EXACT_PATHS.has(pathname)) {
        return false;
    }

    return !NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function getRobotsDirectives(pathname: string) {
    const index = isIndexablePath(pathname);
    return {
        index,
        follow: index,
    };
}

export function getRobotsDisallowList(): string[] {
    return [
        ...Array.from(NOINDEX_EXACT_PATHS),
        ...NOINDEX_PREFIXES.map((prefix) => `${prefix}/`),
    ];
}

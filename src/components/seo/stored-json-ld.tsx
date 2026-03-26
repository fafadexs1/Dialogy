import { JsonLd } from '@/lib/seo/schema';
import { seoStore } from '@/services/seo-store';

function sanitizeIdSegment(value: string) {
    return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'page';
}

export async function StoredSeoJsonLd({ pathname }: { pathname: string }) {
    const entry = await seoStore.getByPath(pathname);
    const raw = entry?.jsonLd?.trim();

    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const validItems = items.filter((item) => item && typeof item === 'object');

        if (validItems.length === 0) {
            return null;
        }

        const idBase = sanitizeIdSegment(pathname);

        return (
            <>
                {validItems.map((item, index) => (
                    <JsonLd
                        key={`${idBase}-${index}`}
                        id={`stored-jsonld-${idBase}-${index}`}
                        data={item as Record<string, unknown>}
                    />
                ))}
            </>
        );
    } catch (error) {
        console.error(`[StoredSeoJsonLd] Invalid JSON-LD for ${pathname}:`, error);
        return null;
    }
}

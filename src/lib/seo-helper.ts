import type { Metadata } from 'next';

import { buildPageMetadata } from '@/lib/seo/metadata';

type PageSeoProps = {
    pathname: string;
    fallbackTitle?: string;
    fallbackDescription?: string;
};

export async function getSeoMetadata({
    pathname,
    fallbackTitle,
    fallbackDescription,
}: PageSeoProps): Promise<Metadata> {
    return buildPageMetadata({
        pathname,
        title: fallbackTitle,
        description: fallbackDescription,
    });
}

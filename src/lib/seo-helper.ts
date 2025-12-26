import { Metadata } from 'next';
import { seoStore } from '@/services/seo-store';

type PageSeoProps = {
    pathname: string;
    fallbackTitle?: string;
    fallbackDescription?: string;
};

export async function getSeoMetadata({
    pathname,
    fallbackTitle = 'My Application',
    fallbackDescription = 'Application description',
}: PageSeoProps): Promise<Metadata> {
    const entry = await seoStore.getByPath(pathname);

    if (!entry) {
        return {
            title: fallbackTitle,
            description: fallbackDescription,
        };
    }

    const { title, description, canonical, robots, ogImage, ogType, jsonLd } = entry;

    // Parse robots string to object
    const robotsObj = {
        index: robots.includes('index'),
        follow: robots.includes('follow'),
    };

    const metadata: Metadata = {
        title: title || fallbackTitle,
        description: description || fallbackDescription,
        robots: robotsObj,
        openGraph: {
            title: title || fallbackTitle,
            description: description || fallbackDescription,
            url: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}${pathname}` : undefined,
            type: ogType as any,
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
        alternates: {
            canonical: canonical || (process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}${pathname}` : undefined),
        },
    };

    // Note: JSON-LD is usually injected via a <script> tag in the component, not directly in Metadata object (except as verification).
    // Ideally, return it separately or handle it here if Next.js adds support. 
    // For now we will focus on standard Metadata.

    return metadata;
}

// Helper component for JSON-LD injection if needed
// function JsonLd({ data }: { data?: string }) { ... }

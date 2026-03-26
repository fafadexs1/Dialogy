import { buildPageMetadata } from '@/lib/seo/metadata';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { JsonLd, getBreadcrumbSchema } from '@/lib/seo/schema';

import CreatorsClient from './creators-client';

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/creators' });
}

export default function CreatorsPage() {
    const breadcrumbSchema = getBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Criadores', path: '/creators' },
    ]);

    return (
        <>
            <JsonLd id="creators-breadcrumb-schema" data={breadcrumbSchema} />
            <StoredSeoJsonLd pathname="/creators" />
            <CreatorsClient />
        </>
    );
}

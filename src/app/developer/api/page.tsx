import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';

import ApiClient from './api-client';

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/developer/api' });
}

export default function ApiPage() {
    return (
        <>
            <StoredSeoJsonLd pathname="/developer/api" />
            <ApiClient />
        </>
    );
}

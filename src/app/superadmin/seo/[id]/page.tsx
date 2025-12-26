import { seoStore } from '@/services/seo-store';
import SeoEditor from '@/components/seo-editor';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Edit SEO Entry',
};

// Force dynamic because we read from local filesystem which might change
export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function SeoEditPage({ params }: PageProps) {
    const { id } = await params;
    const isNew = id === 'new';

    let entry = undefined;

    if (!isNew) {
        entry = await seoStore.getById(id);
        if (!entry) {
            // If not found by ID, maybe we can search by something else?
            // No, strictly by ID for this route to avoid confusion.
            notFound();
        }
    }

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight">
                    {isNew ? 'Create New Entry' : 'Edit Entry'}
                </h1>
                <p className="text-muted-foreground mt-2">
                    {isNew ? 'Define metadata for a new path' : `Editing metadata for ${entry?.pathname}`}
                </p>
            </div>

            <SeoEditor initialData={entry} isNew={isNew} />
        </div>
    );
}

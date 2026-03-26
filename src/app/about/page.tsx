import { Footer } from '@/components/landing/footer';
import { Navbar } from '@/components/landing/navbar';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { Section } from '@/components/landing/ui';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { JsonLd, getBreadcrumbSchema, getOrganizationSchema } from '@/lib/seo/schema';

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/about' });
}

export default async function AboutPage() {
    const organizationSchema = await getOrganizationSchema();
    const breadcrumbSchema = getBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Sobre', path: '/about' },
    ]);

    return (
        <div className="min-h-screen w-full bg-[#020617] text-white">
            <JsonLd id="about-organization-schema" data={organizationSchema} />
            <JsonLd id="about-breadcrumb-schema" data={breadcrumbSchema} />
            <StoredSeoJsonLd pathname="/about" />
            <Navbar />
            <main className="pb-20 pt-32">
                <Section>
                    <h1 className="mb-8 text-5xl font-bold">Sobre a Dialogy</h1>
                    <p className="max-w-3xl text-xl leading-relaxed text-white/70">
                        A Dialogy esta construindo uma plataforma de CRM conversacional e atendimento omnichannel
                        para operacoes que precisam crescer com clareza, automacao e inteligencia aplicada.
                    </p>
                </Section>
            </main>
            <Footer />
        </div>
    );
}

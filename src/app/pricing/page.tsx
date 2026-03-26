import { buildPageMetadata } from '@/lib/seo/metadata';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { JsonLd, getBreadcrumbSchema, getFaqSchema, getSoftwareApplicationSchema } from '@/lib/seo/schema';

import PricingClient from './pricing-client';

const pricingFaqs = [
    {
        question: 'Posso cancelar a qualquer momento?',
        answer: 'Sim. Os planos Basico, Profissional e Empresarial podem ser ajustados conforme a fase da equipe.',
    },
    {
        question: 'Existe teste gratis?',
        answer: 'Sim. Os planos self-serve incluem 7 dias gratis para validar a operacao antes de seguir com a assinatura.',
    },
    {
        question: 'WhatsApp oficial esta incluso?',
        answer: 'Nao. O custo oficial da Meta ou do BSP continua separado do valor do software.',
    },
    {
        question: 'Como funcionam os extras?',
        answer: 'Pacote extra de 500 chats custa R$ 99 por mes, canal extra custa R$ 39 por mes e o IA Copilot custa R$ 149 por workspace.',
    },
    {
        question: 'Quando a API entra no plano?',
        answer: 'API e webhooks entram no plano Empresarial e seguem disponiveis no fluxo de grandes empresas.',
    },
];

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/pricing' });
}

export default async function PricingPage() {
    const [softwareSchema] = await Promise.all([
        getSoftwareApplicationSchema({
            path: '/pricing',
            description: 'Compare os planos da Dialogy para CRM conversacional e atendimento omnichannel com usuarios ilimitados, limite por chats e teste gratis.',
        }),
    ]);
    const faqSchema = getFaqSchema(pricingFaqs);
    const breadcrumbSchema = getBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Precos', path: '/pricing' },
    ]);

    return (
        <>
            <JsonLd id="pricing-software-application-schema" data={softwareSchema} />
            <JsonLd id="pricing-faq-schema" data={faqSchema} />
            <JsonLd id="pricing-breadcrumb-schema" data={breadcrumbSchema} />
            <StoredSeoJsonLd pathname="/pricing" />
            <PricingClient />
        </>
    );
}

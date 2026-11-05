import AiPage from '@/components/landing/ai-page';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { AI_DESCRIPTION, AI_FAQ, AI_TITLE } from '@/content/ai-page';
import { JsonLd, getBreadcrumbSchema, getFaqSchema } from '@/lib/seo/schema';

export async function generateMetadata() {
  return buildPageMetadata({
    pathname: '/ia',
    title: AI_TITLE,
    description: AI_DESCRIPTION,
    keywords: ['IA para atendimento', 'agentes de IA', 'automação com IA', 'Dialogy IA', 'CRM com inteligência artificial'],
  });
}

export default function Page() {
  return <>
    <JsonLd id="dialogy-ai-faq" data={getFaqSchema(AI_FAQ)} />
    <JsonLd id="dialogy-ai-breadcrumb" data={getBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Inteligência artificial', path: '/ia' }])} />
    <AiPage />
  </>;
}

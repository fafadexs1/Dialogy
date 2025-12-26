import { getSeoMetadata } from '@/lib/seo-helper';
import LandingPage from '@/components/landing/landing-page';

export async function generateMetadata() {
  return getSeoMetadata({
    pathname: '/',
    fallbackTitle: 'Dialogy | IA Conversacional para Empresas',
    fallbackDescription: 'Unifique seu atendimento no WhatsApp, Instagram e Web. Automação inteligente para escalar suas vendas e suporte.',
  });
}

export default function Page() {
  return <LandingPage />;
}

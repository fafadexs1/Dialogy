import LandingPage from '@/components/landing/landing-page';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import {
  HOME_FAQ_ITEMS,
  HOME_SEO_DESCRIPTION,
  HOME_SEO_KEYWORDS,
  HOME_SEO_TITLE,
} from '@/content/home-seo';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { seoStore } from '@/services/seo-store';
import { JsonLd, getBreadcrumbSchema, getFaqSchema, getSoftwareApplicationSchema } from '@/lib/seo/schema';

export async function generateMetadata() {
  return buildPageMetadata({
    pathname: '/',
    title: HOME_SEO_TITLE,
    description: HOME_SEO_DESCRIPTION,
    keywords: HOME_SEO_KEYWORDS,
  });
}

export default async function Page() {
  const [softwareSchema] = await Promise.all([
    getSoftwareApplicationSchema({
      path: '/',
      description: HOME_SEO_DESCRIPTION,
    }),
  ]);
  const breadcrumbSchema = getBreadcrumbSchema([
    { name: 'Home', path: '/' },
  ]);
  const faqSchema = getFaqSchema(HOME_FAQ_ITEMS);

  const entry = await seoStore.getByPath('/');
  const hasStoredJsonLd = !!entry?.jsonLd;

  return (
    <>
      {!hasStoredJsonLd && (
        <>
          <JsonLd id="dialogy-home-software-application" data={softwareSchema} />
          <JsonLd id="dialogy-home-breadcrumb" data={breadcrumbSchema} />
          <JsonLd id="dialogy-home-faq" data={faqSchema} />
        </>
      )}
      <StoredSeoJsonLd pathname="/" />
      <LandingPage />
    </>
  );
}

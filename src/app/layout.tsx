import './globals.css';

import type { Metadata, Viewport } from 'next';

import { getServerLocale } from '@/i18n/server';
import { buildRootMetadata } from '@/lib/seo/metadata';
import { JsonLd, getOrganizationSchema, getWebSiteSchema } from '@/lib/seo/schema';

export async function generateMetadata(): Promise<Metadata> {
  return buildRootMetadata();
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();
  const [organizationSchema, websiteSchema] = await Promise.all([
    getOrganizationSchema(),
    getWebSiteSchema(),
  ]);

  return (
    <html lang={locale} className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Code+Pro&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full font-body antialiased" suppressHydrationWarning>
        <JsonLd id="dialogy-organization-schema" data={organizationSchema} />
        <JsonLd id="dialogy-website-schema" data={websiteSchema} />
        {children}
      </body>
    </html>
  );
}

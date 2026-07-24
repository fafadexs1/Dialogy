import { WebchatClient } from './webchat-client';

export default async function WebchatPage({ params, searchParams }: { params: Promise<{ publicKey: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { publicKey } = await params;
  const query = await searchParams;
  const value = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  return <WebchatClient publicKey={publicKey} parentOrigin={value('origin')} currentUrl={value('url')} referrer={value('referrer')} />;
}

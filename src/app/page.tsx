import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';

export default async function Home() {
  const session = await auth();

  // Os dados do usuário vêm diretamente da sessão, sem consulta ao banco.
  // Isso torna o carregamento da página principal muito mais rápido e estável.
  const user: User = {
    id: session?.user?.id ?? 'guest',
    name: session?.user?.name ?? 'Guest',
    email: session?.user?.email ?? '',
    avatar: session?.user?.image ?? 'https://placehold.co/40x40.png',
  };

  return <MainLayout user={user} />;
}

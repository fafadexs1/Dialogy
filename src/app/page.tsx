import { MainLayout } from '@/components/layout/main-layout';
import { auth } from '@/auth';
import type { User } from '@/lib/types';
import prisma from '@/lib/db';

export default async function Home() {
  const session = await auth();

  // Se o usuário estiver autenticado, buscamos os dados do banco
  // caso contrário, usamos um usuário convidado.
  const dbUser = session?.user?.email 
    ? await prisma.user.findUnique({ where: { email: session.user.email }})
    : null;

  const user: User = {
    id: dbUser?.id ?? 'guest',
    name: dbUser?.name ?? 'Guest',
    email: dbUser?.email ?? '',
    // Usamos um placeholder se não houver avatar no banco
    avatar: 'https://placehold.co/40x40.png',
  };

  return <MainLayout user={user} />;
}

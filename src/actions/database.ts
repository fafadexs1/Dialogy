
'use server';

import { db } from '@/lib/db';

export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: "A inicialização manual do banco de dados foi descontinuada. Use o Prisma Migrate para gerenciar o schema do seu banco de dados. Execute 'npx prisma migrate dev' no seu terminal.",
  };
}

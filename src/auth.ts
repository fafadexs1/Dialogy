import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import prisma from './lib/db';
import bcrypt from 'bcrypt';
import type { User } from '@prisma/client';

async function getUser(email: string): Promise<User | null> {
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    return user;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        if (credentials?.email && credentials?.password) {
          const { email, password } = credentials;
          const user = await getUser(email as string);

          if (!user) return null;

          const passwordsMatch = await bcrypt.compare(
            password as string,
            user.password
          );

          if (passwordsMatch) {
            // Retornamos um objeto de usuário sem a senha
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
          }
        }
        return null;
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
});
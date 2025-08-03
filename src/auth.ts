import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import prisma from './lib/db';
import bcrypt from 'bcrypt';
import type { User } from '@prisma/client';

console.log('src/auth.ts: Arquivo auth.ts carregado');

async function getUser(email: string): Promise<User | null> {
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    return user;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

export const {
  handlers,
  auth,
  signIn,
  signOut
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        if (credentials?.email && credentials?.password) {
          const { email, password } = credentials;
          const user = await getUser(email as string);

          if (!user) {
            console.log('src/auth.ts: Autorização falhou - usuário não encontrado');
            return null;
          }

          const passwordsMatch = await bcrypt.compare(
            password as string,
            user.password
          );

 if (passwordsMatch) {
            // Retornamos um objeto de usuário sem a senha
            const { password, ...userWithoutPassword } = user;
            console.log('src/auth.ts: Autorização bem-sucedida para o usuário', userWithoutPassword.email);
            return userWithoutPassword;
          }
        }
        console.log('src/auth.ts: Autorização falhou - credenciais inválidas ou incompletas');
        return null;
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  callbacks: {
    async session({ session, token }) {
      console.log('src/auth.ts: Callback de sessão acionado', { session, token });
 return session;
    },
    async jwt({ token, user }) {
      console.log('src/auth.ts: Callback JWT acionado', {
        token,
        user
      });
 if (user) {
        token.id = user.id;
      }
 return token;
    },
  },
});
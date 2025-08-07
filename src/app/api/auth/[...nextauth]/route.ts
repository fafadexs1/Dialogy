
import NextAuth from 'next-auth';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        console.log('--- [AUTH] Iniciando processo de autorização ---');
        if (!credentials?.email || !credentials.password) {
          console.log('[AUTH] Falhou: Email ou senha não fornecidos.');
          return null;
        }

        console.log(`[AUTH] Tentando autorizar usuário com email: ${credentials.email}`);

        try {
          const result = await db.query('SELECT id, full_name, email, password_hash, avatar_url FROM users WHERE email = $1', [credentials.email]);
          const user = result.rows[0];

          if (!user) {
            console.log(`[AUTH] Usuário com email ${credentials.email} não encontrado.`);
            return null;
          }
          console.log(`[AUTH] Usuário encontrado: ${user.full_name} (ID: ${user.id})`);

          const passwordIsValid = await bcrypt.compare(credentials.password, user.password_hash);
          console.log(`[AUTH] Verificação de senha para ${credentials.email}: ${passwordIsValid ? 'VÁLIDA' : 'INVÁLIDA'}`);

          if (passwordIsValid) {
            console.log(`[AUTH] Autorização bem-sucedida para ${user.full_name}.`);
            return {
              id: user.id,
              name: user.full_name,
              email: user.email,
              image: user.avatar_url,
            };
          } else {
            console.log(`[AUTH] Senha inválida para o usuário ${credentials.email}.`);
            return null;
          }
        } catch (error) {
          console.error('[AUTH] Erro catastrófico durante a autorização:', error);
          return null;
        }
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      console.log('[AUTH_CALLBACK] JWT: Adicionando ID do usuário ao token.');
      if (user) {
        token.id = user.id;
      }
      console.log('[AUTH_CALLBACK] JWT: Token final:', token);
      return token;
    },
    async session({ session, token }) {
      console.log('[AUTH_CALLBACK] Session: Adicionando ID do usuário à sessão.');
      if (session.user) {
        session.user.id = token.id as string;
      }
      console.log('[AUTH_CALLBACK] Session: Sessão final:', session);
      return session;
    },
  },
  pages: {
    signIn: '/login',
  }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST, authOptions as auth };

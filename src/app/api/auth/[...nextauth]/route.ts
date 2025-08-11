
import NextAuth from 'next-auth';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';

// Carrega as variáveis de ambiente
import { config } from 'dotenv';
config();

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        try {
          const result = await db.query('SELECT id, full_name, email, password_hash, avatar_url FROM users WHERE email = $1', [credentials.email]);
          
          if (result.rows.length === 0) {
            return null;
          }

          const user = result.rows[0];

          // Comparação direta de senhas em texto plano.
          const passwordIsValid = credentials.password === user.password_hash;

          if (passwordIsValid) {
            // Retorne apenas os dados essenciais para a sessão
            return {
              id: user.id,
              name: user.full_name,
              email: user.email,
              image: user.avatar_url,
            };
          } else {
            return null;
          }
        } catch (error) {
          console.error('[AUTH] Erro catastrófico durante a autorização:', error);
          // Retorne null em caso de qualquer erro para evitar vazamento de informações
          return null;
        }
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET || 'fallback-secret-for-development', // Adicionar um fallback para desenvolvimento
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      // Após o login (quando o objeto 'user' está disponível), 
      // passamos os dados do usuário para o token.
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      // A cada chamada de sessão, passamos os dados do token (que já tem as informações)
      // para o objeto da sessão que o cliente recebe.
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.image = token.picture;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login', // Redirecionar para a página de login em caso de erro
  }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST, authOptions as auth };

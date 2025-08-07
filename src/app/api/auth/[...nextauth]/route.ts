
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
        console.log('--- Iniciando processo de autorização ---');
        if (!credentials?.email || !credentials.password) {
          console.log('Autorização falhou: Email ou senha não fornecidos.');
          return null;
        }

        console.log(`Tentando autorizar usuário com email: ${credentials.email}`);

        try {
          const result = await db.query('SELECT id, full_name, email, password_hash, avatar_url FROM users WHERE email = $1', [credentials.email]);
          const user = result.rows[0];

          if (!user) {
            console.log(`Usuário com email ${credentials.email} não encontrado no banco de dados.`);
            return null;
          }
          console.log(`Usuário encontrado: ${user.full_name}`);

          const passwordIsValid = await bcrypt.compare(credentials.password, user.password_hash);
          console.log(`Verificação de senha para ${credentials.email}: ${passwordIsValid ? 'VÁLIDA' : 'INVÁLIDA'}`);

          if (passwordIsValid) {
            console.log(`Autorização bem-sucedida para ${user.full_name}. Retornando dados do usuário.`);
            // Return the user object without the password hash
            return {
              id: user.id,
              name: user.full_name,
              email: user.email,
              image: user.avatar_url,
            };
          } else {
            console.log(`Senha inválida para o usuário ${credentials.email}.`);
            return null; // Invalid credentials
          }
        } catch (error) {
          console.error('Erro catastrófico durante a autorização no authorize:', error);
          return null; // Error during authorization
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
      // When a user signs in, the `user` object is available.
      // We add the user ID to the token here.
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      // The session callback receives the token with the user ID.
      // We add the ID to the session object.
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    // signOut: '/auth/signout',
    // error: '/auth/error', // Error code passed in query string as ?error=
    // verifyRequest: '/auth/verify-request', // (e.g. for email verification)
    // newUser: '/auth/new-user' // New users will be directed here on first sign in (leave the property out to disable)
  }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST, authOptions as auth };

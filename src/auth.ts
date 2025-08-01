import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { agents } from './lib/mock-data';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        if (credentials) {
          const { email, password } = credentials;
          const user = agents.find((agent) => agent.email === email);
          
          // For demo purposes, we accept any agent email with the password "password"
          if (user && password === 'password') {
            return { id: user.id, name: user.name, email: user.email, avatar: user.avatar };
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

import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  providers: [], // Add providers in auth.ts
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLoginPage = nextUrl.pathname.startsWith('/login');
      const isOnRegisterPage = nextUrl.pathname.startsWith('/register');

      // Se estiver logado, não pode acessar login/register, redireciona para a home
      if (isLoggedIn && (isOnLoginPage || isOnRegisterPage)) {
        return Response.redirect(new URL('/', nextUrl));
      }

      // Se não estiver logado e tentar acessar uma rota protegida (que não seja login/register)
      if (!isLoggedIn && !isOnLoginPage && !isOnRegisterPage) {
        return Response.redirect(new URL('/login', nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
        if (user) {
          token.id = user.id;
          if(user.avatar) token.picture = user.avatar;
        }
        return token;
      },
      session({ session, token }) {
        if (session.user) {
          session.user.id = token.id as string;
          if (token.picture) session.user.image = token.picture;
        }
        return session;
      },
  },
} satisfies NextAuthConfig;

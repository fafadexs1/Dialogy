import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  providers: [], // Add providers in auth.ts
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const protectedRoutes = ['/'];
      const isProtectedRoute = protectedRoutes.some((route) =>
        nextUrl.pathname.startsWith(route)
      );

      if (isProtectedRoute && !isLoggedIn) {
        return Response.redirect(new URL('/login', nextUrl));
      }

      if (isLoggedIn && nextUrl.pathname.startsWith('/login')) {
        return Response.redirect(new URL('/', nextUrl));
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

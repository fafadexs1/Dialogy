import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const isAuthPage = req.nextUrl.pathname.startsWith('/login') || req.nextUrl.pathname.startsWith('/register');

  if (isAuthPage) {
    if (session) {
      return NextResponse.redirect(new URL('/', req.url))
    }
  } else {
    if (!session) {
      // Se não houver sessão e a página não for de autenticação, redireciona para o login
      let redirectUrl = new URL('/login', req.url)
      // Adiciona a URL de retorno para que o usuário seja redirecionado após o login
      if (req.nextUrl.pathname !== '/') {
        redirectUrl.searchParams.set('redirect_to', req.nextUrl.pathname)
      }
      return NextResponse.redirect(redirectUrl)
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
};

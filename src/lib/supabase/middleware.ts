import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { baseCookieOptions, buildSessionCookieOptions } from '@/lib/supabase/cookie-options'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: baseCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookies) {
          const mergedCookies = cookies.map(({ name, value, options }) => {
            const mergedOptions = buildSessionCookieOptions(options)
            request.cookies.set({ name, value, ...mergedOptions })
            return { name, value, options: mergedOptions }
          })

          response = NextResponse.next({
            request: {
              headers: new Headers(request.headers),
            },
          })

          mergedCookies.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options })
          })
        },
      },
    }
  )

  // IMPORTANTE: Este comando atualiza a sessão se ela tiver expirado.
  // Usamos getSession() em vez de getUser() para evitar chamadas excessivas ao Auth Server.
  // getSession() usa o token local se válido.
  if (supabase && supabase.auth) {
    await supabase.auth.getSession()
  }

  return response
}

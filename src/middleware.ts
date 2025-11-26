import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // Log Server Action requests
  if (request.method === 'POST' && request.headers.get('next-action')) {
    const actionId = request.headers.get('next-action');
    console.log(`[MIDDLEWARE] Server Action Request: ${actionId} | URL: ${request.url} | UA: ${request.headers.get('user-agent')}`);
  }

  // updateSession will take care of refreshing the session cookie
  // if it's expired.
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

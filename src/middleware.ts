import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // Only refresh the session for full page/HTML navigations.
  // This avoids hammering Supabase Auth for JSON/data requests (e.g., polling, prefetch).
  const acceptHeader = request.headers.get('accept') ?? '';
  const isHtmlRequest = acceptHeader.includes('text/html');

  if (!isHtmlRequest) {
    return NextResponse.next();
  }

  // updateSession will take care of refreshing the session cookie if it's expired.
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
    '/((?!api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

export { default } from "next-auth/middleware"

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - login (the login page)
     * - register (the register page)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - setup (database setup page)
     * - chat (allow access to chat pages for debugging)
     */
    '/((?!api|login|register|_next/static|_next/image|favicon.ico|setup|chat).*)',
  ],
}

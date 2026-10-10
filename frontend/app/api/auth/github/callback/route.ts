import { NextResponse, type NextRequest } from 'next/server'

// Compatibility with OAuth Apps registered with the reponix-style callback URL
// (http://<host>/api/auth/github/callback). The code is exchanged by the
// signed-in /github/callback page, so just hand the query string over.
export function GET(request: NextRequest) {
  const target = new URL('/github/callback', request.url)
  target.search = request.nextUrl.search
  return NextResponse.redirect(target)
}

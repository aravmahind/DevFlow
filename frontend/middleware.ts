import { NextResponse } from 'next/server'
import type { NextFetchEvent, NextRequest } from 'next/server'
import { clerkMiddleware } from '@clerk/nextjs/server'

const BYPASS_AUTH = process.env.NEXT_PUBLIC_BYPASS_AUTH !== 'false'
const PROTECTED_PREFIXES = ['/workspace', '/my-projects', '/my-tasks', '/invite', '/github']

const clerkHandler = clerkMiddleware(async (auth, request) => {
  if (PROTECTED_PREFIXES.some((path) => request.nextUrl.pathname.startsWith(path))) {
    await auth.protect()
  }
})

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  // When auth is bypassed, just pass through — no Clerk middleware needed.
  if (BYPASS_AUTH) {
    return NextResponse.next()
  }

  return clerkHandler(request, event)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}

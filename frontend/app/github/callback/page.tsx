'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Github, Loader2 } from 'lucide-react'
import { completeGithubConnect } from '@/lib/api'
import { useAppUser } from '@/lib/auth-context'

// GitHub sends the user back here after they approve (or cancel) the OAuth
// prompt. The code is single-use, so it is exchanged exactly once even though
// React may run effects twice in development.
const exchanged = new Set<string>()

function GithubCallback() {
  const params = useSearchParams()
  const router = useRouter()
  const { isLoaded, isSignedIn, user } = useAppUser()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  const code = params?.get('code') || ''
  const state = params?.get('state') || ''
  const denied = params?.get('error')

  useEffect(() => {
    if (denied) {
      setError(denied === 'access_denied' ? 'GitHub access was not granted.' : params?.get('error_description') || denied)
      return
    }
    if (!code || !state) {
      setError('This page was opened without a GitHub authorization code.')
      return
    }
    if (!isLoaded || !isSignedIn || !user || started.current || exchanged.has(code)) return
    started.current = true
    exchanged.add(code)
    // Defer one tick: the auth token provider is installed by a parent effect,
    // which React runs after this one.
    const timer = setTimeout(async () => {
      try {
        const { return_to } = await completeGithubConnect(code, state)
        router.replace(return_to || '/my-projects')
      } catch (err) {
        setError(err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Could not connect GitHub.')
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [code, state, denied, isLoaded, isSignedIn, user, router, params])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Github className="h-6 w-6" />
        </div>
        {error ? (
          <>
            <h1 className="text-lg font-bold text-slate-900">GitHub was not connected</h1>
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-left text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
            <Link href="/my-projects" className="mt-5 inline-block text-sm font-semibold text-blue-600 hover:text-blue-700">
              Back to my projects
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-slate-900">Connecting your GitHub account…</h1>
            <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-slate-400" />
          </>
        )}
      </section>
    </main>
  )
}

export default function GithubCallbackPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
      <GithubCallback />
    </Suspense>
  )
}

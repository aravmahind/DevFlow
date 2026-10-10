'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, Github, Loader2, Lock, Search, Star, Unlink } from 'lucide-react'
import {
  connectGithubAccount,
  disconnectGithubAccount,
  getGithubAccount,
  listGithubRepos,
  type GithubAccountStatus,
  type GithubRepoOption,
} from '@/lib/api'

const cleanError = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^\d+:\s*/, '')

export function useGithubAccount() {
  const [status, setStatus] = useState<GithubAccountStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getGithubAccount())
      setError(null)
    } catch (err) {
      setError(cleanError(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, error, refresh, loading: !status && !error }
}

export function ConnectGithubButton({ returnTo, label = 'Connect GitHub' }: { returnTo: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await connectGithubAccount(returnTo)
          } catch (err) {
            setError(cleanError(err))
            setBusy(false)
          }
        }}
        className="inline-flex items-center gap-2.5 rounded-xl bg-[#24292f] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1b1f23] disabled:opacity-60 cursor-pointer"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Github className="h-5 w-5" />}
        {label}
      </button>
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
    </div>
  )
}

/** Connection state for the signed-in user's GitHub account. */
export function GithubAccountCard({
  status,
  returnTo,
  onChanged,
}: {
  status: GithubAccountStatus
  returnTo: string
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const account = status.account

  if (!account) {
    return (
      <div className="space-y-3">
        <ConnectGithubButton returnTo={returnTo} />
        <p className="text-xs text-slate-500">
          Pick any of your repositories, including private and organization ones.
        </p>
      </div>
    )
  }

  const disconnect = async () => {
    if (!confirm(`Disconnect @${account.login}? Repositories linked through this account will stop syncing until you reconnect or relink them.`)) return
    setBusy(true)
    setError(null)
    try {
      await disconnectGithubAccount()
      onChanged()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {account.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.avatar_url} alt="" className="h-9 w-9 rounded-full border border-slate-200" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white"><Github className="h-4 w-4" /></div>
          )}
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Connected as</p>
            <p className="truncate text-sm font-semibold text-slate-900">
              {account.name || account.login} <span className="font-normal text-slate-500">@{account.login}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.manage_access_url && (
            <a
              href={status.manage_access_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              title="Grant access to organization repositories"
            >
              Org access <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 cursor-pointer"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />} Disconnect
          </button>
        </div>
      </div>
      {account.needs_reconnect && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            GitHub no longer accepts this connection (it was revoked or expired).
          </p>
          <ConnectGithubButton returnTo={returnTo} label="Reconnect" />
        </div>
      )}
      {!account.needs_reconnect && !account.can_read_private && (
        <p className="text-xs text-amber-700">This connection can only see public repositories. Reconnect and approve repository access to link private ones.</p>
      )}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  )
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Go: '#00ADD8', Rust: '#dea584',
  Java: '#b07219', Kotlin: '#A97BFF', Swift: '#F05138', 'C#': '#178600', 'C++': '#f34b7d', C: '#555555',
  Ruby: '#701516', PHP: '#4F5D95', Dart: '#00B4AB', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051',
}
const languageColor = (lang: string) => LANGUAGE_COLORS[lang] || '#94a3b8'

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** Searchable list of the connected account's repositories. */
export function RepoPicker({
  onPick,
  busyRepo,
  manageAccessUrl,
}: {
  onPick: (repo: GithubRepoOption) => void
  busyRepo: string | null
  manageAccessUrl: string | null
}) {
  const [repos, setRepos] = useState<GithubRepoOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    listGithubRepos()
      .then((res) => alive && setRepos(res.repos))
      .catch((err) => alive && setError(cleanError(err)))
    return () => {
      alive = false
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (repos || []).filter((r) => !q
      || r.full_name.toLowerCase().includes(q)
      || r.language?.toLowerCase().includes(q)
      || r.description?.toLowerCase().includes(q))
  }, [repos, query])
  const privateCount = (repos || []).filter((r) => r.private).length

  if (error) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or language…"
          className="flex-1 bg-transparent py-2.5 text-sm outline-none"
          aria-label="Search repositories"
        />
        {repos && (
          <span className="shrink-0 text-[11px] text-slate-400">
            {repos.length} repos{privateCount ? ` · ${privateCount} private` : ''}
          </span>
        )}
      </div>
      <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100">
        {!repos && (
          <li className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading repositories…
          </li>
        )}
        {repos && filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-slate-500">
            No repositories match.
            {manageAccessUrl && (
              <>
                {' '}Missing an organization repo?{' '}
                <a href={manageAccessUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:text-blue-700">
                  Grant org access
                </a>
              </>
            )}
          </li>
        )}
        {filtered.map((r) => (
          <li key={r.full_name}>
            <button
              type="button"
              disabled={!!busyRepo}
              onClick={() => onPick(r)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                  {r.full_name}
                  {r.private ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 px-1.5 text-[10px] font-medium text-slate-500">
                      <Lock className="h-2.5 w-2.5" /> Private
                    </span>
                  ) : (
                    <span className="rounded-full border border-slate-200 px-1.5 text-[10px] font-medium text-slate-400">Public</span>
                  )}
                </p>
                {r.description && <p className="truncate text-[11px] text-slate-500">{r.description}</p>}
                <p className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
                  {r.language && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: languageColor(r.language) }} /> {r.language}
                    </span>
                  )}
                  {r.stars > 0 && <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3" /> {r.stars}</span>}
                  <span>Updated {timeAgo(r.pushed_at || r.updated_at)}</span>
                </p>
              </div>
              <span className="shrink-0">
                {busyRepo === r.full_name
                  ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  : <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">Link</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

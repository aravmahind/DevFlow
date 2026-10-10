'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Link2,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Star,
  Unlink,
  Users,
  Webhook,
} from 'lucide-react'
import { useProjectStore } from '@/lib/project-store'
import { GithubAccountCard, RepoPicker, useGithubAccount } from '@/components/github/github-account'
import {
  askRepo,
  getGithub,
  linkGithub,
  listGithubCommits,
  syncGithub,
  unlinkGithub,
  type GithubCommit,
  type GithubContributor,
  type GithubItemStatus,
  type GithubOverview,
  type GithubPlanItem,
  type GithubRepoOption,
} from '@/lib/api'

type Tab = 'status' | 'activity' | 'contributors' | 'chat'

const STATUS_STYLE: Record<GithubItemStatus, { label: string; pill: string; icon: ReactNode }> = {
  implemented: {
    label: 'Likely complete',
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  in_progress: {
    label: 'In progress',
    pill: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  not_started: {
    label: 'Not started',
    pill: 'bg-slate-50 text-slate-500 border-slate-200',
    icon: <CircleDashed className="w-3.5 h-3.5" />,
  },
}

const CATEGORY_STYLE: Record<string, string> = {
  feature: 'bg-blue-50 text-blue-700 border-blue-200',
  fix: 'bg-rose-50 text-rose-700 border-rose-200',
  refactor: 'bg-violet-50 text-violet-700 border-violet-200',
  docs: 'bg-sky-50 text-sky-700 border-sky-200',
  test: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  chore: 'bg-slate-100 text-slate-600 border-slate-200',
  merge: 'bg-slate-100 text-slate-500 border-slate-200',
}

const LANG_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#64748b']

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

function Avatar({ src, name, size = 'w-6 h-6' }: { src?: string | null; name: string; size?: string }) {
  return (
    <img
      src={src || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || '?')}&background=e2e8f0&color=475569`}
      alt={name}
      title={name}
      className={`${size} rounded-full border border-white ring-1 ring-slate-200 object-cover shrink-0`}
    />
  )
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-slate-200 rounded-2xl shadow-xs ${className}`}>{children}</div>
}

/** Minimal markdown → React (bold, inline code, bullets, headings, tables). No HTML injection. */
function Markdown({ text }: { text: string }) {
  const inline = (line: string, key: string): ReactNode[] =>
    line.split(/<br\s*\/?>/i).flatMap((seg, j) => [
      ...(j ? [<br key={`${key}-br${j}`} />] : []),
      ...inlineSpans(seg, `${key}-${j}`),
    ])
  const inlineSpans = (line: string, key: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={`${key}-${i}`} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={`${key}-${i}`} className="px-1 py-0.5 rounded bg-slate-100 text-[11px] font-mono text-slate-700">{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={`${key}-${i}`}>{part}</Fragment>
      ),
    )
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  let table: string[][] = []
  const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1">{list}</ul>)
    list = []
    if (table.length) {
      const [head, ...body] = table
      const k = `tbl-${blocks.length}`
      blocks.push(
        <div key={k} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>{head.map((h, i) => <th key={i} className="text-left font-semibold px-2.5 py-1.5">{inline(h, `${k}h${i}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {body.map((row, r) => (
                <tr key={r}>{row.map((c, i) => <td key={i} className="px-2.5 py-1.5 align-top">{inline(c, `${k}r${r}c${i}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    }
    table = []
  }
  text.split('\n').forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (list.length) { const pending = table; table = []; flush(); table = pending }
      if (!/^\s*\|?\s*:?-{2,}/.test(line)) table.push(cells(line))
      return
    }
    if (table.length) flush()
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/)
    if (bullet) {
      list.push(<li key={idx}>{inline(bullet[1], `li${idx}`)}</li>)
      return
    }
    flush()
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading) blocks.push(<p key={idx} className="font-bold text-slate-900 mt-1">{inline(heading[1], `h${idx}`)}</p>)
    else if (line.trim()) blocks.push(<p key={idx}>{inline(line, `p${idx}`)}</p>)
  })
  flush()
  return <div className="space-y-2">{blocks}</div>
}

// ---------------------------------------------------------------------------
// Link form (shown before a repository is connected)
// ---------------------------------------------------------------------------
function LinkRepoForm({ projectId, canManage, onLinked, initialRepo = '' }: {
  projectId: string
  canManage: boolean
  onLinked: (data: GithubOverview) => void
  initialRepo?: string
}) {
  const { status, error: accountError, refresh } = useGithubAccount()
  const [busyRepo, setBusyRepo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const returnTo = `/workspace?project=${projectId}&view=github`

  if (!canManage) {
    return (
      <Card className="p-8 text-center">
        <Github className="w-8 h-8 mx-auto text-slate-400 mb-3" />
        <h3 className="font-bold text-slate-900">No repository linked yet</h3>
        <p className="text-sm text-slate-500 mt-1">A project manager can link this project to a GitHub repository to track implementation progress.</p>
      </Card>
    )
  }

  const account = status?.account
  const accountReady = !!status?.configured && !!account && !account.needs_reconnect
  const pick = async (repo: GithubRepoOption) => {
    setBusyRepo(repo.full_name)
    setError(null)
    try {
      onLinked(await linkGithub(projectId, repo.full_name, { useAccount: true }))
    } catch (err: any) {
      setError(String(err?.message || err).replace(/^\d+:\s*/, ''))
    } finally {
      setBusyRepo(null)
    }
  }

  return (
    <div className="space-y-4" data-testid="github-link-form">
      {!status && !accountError && (
        <p className="text-xs text-slate-500 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking your GitHub connection…</p>
      )}
      {status && <GithubAccountCard status={status} returnTo={returnTo} onChanged={refresh} />}
      {accountReady && (
        <RepoPicker onPick={pick} busyRepo={busyRepo} manageAccessUrl={status?.manage_access_url ?? null} />
      )}
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {status || accountError ? (
        <div className="pt-1">
          <button type="button" onClick={() => setManual((v) => !v)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 cursor-pointer">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${manual ? 'rotate-180' : ''}`} />
            Link by URL or access token instead
          </button>
          {manual && <div className="mt-3"><ManualLinkForm projectId={projectId} onLinked={onLinked} initialRepo={initialRepo} /></div>}
        </div>
      ) : null}
    </div>
  )
}

function ManualLinkForm({ projectId, onLinked, initialRepo = '' }: {
  projectId: string
  onLinked: (data: GithubOverview) => void
  initialRepo?: string
}) {
  const [repo, setRepo] = useState(initialRepo)
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onLinked(await linkGithub(projectId, repo.trim(), { accessToken: token.trim() || undefined }))
    } catch (err: any) {
      setError(String(err?.message || err).replace(/^\d+:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="off">
      <div>
        <label className="text-xs font-semibold text-slate-700">Repository</label>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
          <Github className="w-4 h-4 text-slate-400" />
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="https://github.com/owner/repo or owner/repo"
            className="flex-1 py-2.5 text-sm outline-none bg-transparent"
            name="github-repository"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            required
          />
        </div>
      </div>
      <div>
        <button type="button" onClick={() => setShowToken((v) => !v)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 cursor-pointer">
          <Lock className="w-3.5 h-3.5" /> {showToken ? 'Hide' : 'Add'} access token (private repos, higher rate limit, auto webhook)
        </button>
        {showToken && (
          <div className="mt-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              name="github-access-token"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
            />
            <p className="text-[11px] text-slate-500 mt-1">Fine-grained token with read access to Contents and Metadata (plus Webhooks: write to auto-register). Stored encrypted and never shown again.</p>
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !repo.trim()}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer inline-flex items-center gap-2"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
        Link repository
      </button>
    </form>
  )
}

function NotLinked(props: { projectId: string; canManage: boolean; onLinked: (d: GithubOverview) => void }) {
  const features = [
    { icon: <CheckCircle2 className="w-4 h-4" />, title: 'Implementation status', text: 'Every commit is mapped to your backlog tasks and requirements, so you can see what has actually been built. It also feeds the GitHub Monitor agent.' },
    { icon: <Users className="w-4 h-4" />, title: 'Who built what', text: 'Per-contributor ownership: commits, lines changed, areas of the code, and features delivered.' },
    { icon: <Webhook className="w-4 h-4" />, title: 'Updates on every push', text: 'A push webhook (or polling fallback) re-syncs the tracker automatically.' },
    { icon: <Bot className="w-4 h-4" />, title: 'Ask the repo', text: 'Chat with an AI that knows the code structure, history, and contributors.' },
  ]
  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <Card className="lg:col-span-3 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center"><Github className="w-6 h-6" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Link a GitHub repository</h2>
            <p className="text-xs text-slate-500">Track what is implemented against this project's plan.</p>
          </div>
        </div>
        <LinkRepoForm {...props} />
      </Card>
      <div className="lg:col-span-2 grid gap-3">
        {features.map((f) => (
          <Card key={f.title} className="p-4 flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">{f.icon}</div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{f.title}</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{f.text}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header + settings
// ---------------------------------------------------------------------------
function SyncBadge({ status, error }: { status: string; error?: string | null }) {
  if (status === 'ready' && error)
    return <span title={error} className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" /> Partially synced</span>
  if (status === 'syncing' || status === 'pending')
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full"><Loader2 className="w-3 h-3 animate-spin" /> Syncing</span>
  if (status === 'failed')
    return <span title={error || ''} className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" /> Sync failed</span>
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3" /> Up to date</span>
}

function RepoHeader({ data, canSync, canManage, onSync, settingsOpen, onToggleSettings }: {
  data: GithubOverview
  canSync: boolean
  canManage: boolean
  onSync: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
}) {
  const link = data.link!
  const repo = data.repo!
  const langs = Object.entries(repo.languages || {})
  const total = langs.reduce((n, [, v]) => n + v, 0) || 1
  const syncing = link.sync_status === 'syncing' || link.sync_status === 'pending'
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Github className="w-5 h-5 text-slate-900" />
            <a href={link.html_url} target="_blank" rel="noreferrer" className="text-lg font-bold text-slate-900 hover:text-blue-600 inline-flex items-center gap-1">
              {link.full_name} <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {repo.private && <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border border-slate-200 rounded-full px-2 py-0.5">Private</span>}
            <SyncBadge status={link.sync_status} error={link.sync_error} />
          </div>
          {repo.description && <p className="text-sm text-slate-600 mt-1">{repo.description}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><GitBranch className="w-3.5 h-3.5" /> {link.default_branch}</span>
            <span className="inline-flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {repo.stars?.toLocaleString() ?? 0}</span>
            <span className="inline-flex items-center gap-1"><GitCommitHorizontal className="w-3.5 h-3.5" /> {data.stats?.commits ?? 0} commits tracked</span>
            <span>Synced {timeAgo(link.last_synced_at)}</span>
            {link.linked_by && <span>Linked by {link.linked_by}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canSync && (
            <button onClick={onSync} disabled={syncing} className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 font-semibold text-xs rounded-xl shadow-xs inline-flex items-center gap-1.5 cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync now
            </button>
          )}
          {canManage && (
            <button onClick={onToggleSettings} className={`px-3 py-2 border font-semibold text-xs rounded-xl shadow-xs inline-flex items-center gap-1.5 cursor-pointer ${settingsOpen ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'}`}>
              <Settings2 className="w-3.5 h-3.5" /> Settings
            </button>
          )}
        </div>
      </div>
      {link.sync_error && !syncing && (
        <p className={`mt-3 text-xs rounded-lg px-3 py-2 border flex items-start gap-2 ${link.sync_status === 'failed' ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {link.sync_error}
        </p>
      )}
      {langs.length > 0 && (
        <div className="mt-4">
          <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
            {langs.slice(0, 7).map(([name, bytes], i) => (
              <div key={name} style={{ width: `${(100 * bytes) / total}%`, background: LANG_COLORS[i] }} title={name} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {langs.slice(0, 7).map(([name, bytes], i) => (
              <span key={name} className="text-[11px] text-slate-600 inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: LANG_COLORS[i] }} /> {name} <span className="text-slate-400">{((100 * bytes) / total).toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function SettingsPanel({ data, projectId, onChanged }: { data: GithubOverview; projectId: string; onChanged: (d: GithubOverview | null) => void }) {
  const link = data.link!
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [relink, setRelink] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setActionError(null)
    try {
      await fn()
    } catch (err: any) {
      setActionError(String(err?.message || err).replace(/^\d+:\s*/, ''))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card className="p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Lock className="w-4 h-4 text-blue-600" /> Repository access</h3>
        <p className="text-xs text-slate-500 mt-1">
          {link.auth === 'account'
            ? <>Read through {link.account_login ? <b>@{link.account_login}</b> : 'a'}&apos;s connected GitHub account{link.linked_by ? ` (linked by ${link.linked_by})` : ''}. If that account is disconnected, syncing pauses until it reconnects or the repository is relinked.</>
            : link.auth === 'token'
              ? 'Read with an access token saved on this link.'
              : 'Read anonymously (public repository). Connect a GitHub account for private repositories and higher rate limits.'}
        </p>
      </div>
      <div className="pt-4 border-t border-slate-100">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Webhook className="w-4 h-4 text-blue-600" /> Push webhook</h3>
        {link.webhook.auto_registered ? (
          <p className="text-xs text-emerald-700 mt-1">Registered on GitHub automatically. Every push to <b>{link.default_branch}</b> triggers a sync.</p>
        ) : (
          <p className="text-xs text-slate-500 mt-1">
            Add this in GitHub → Settings → Webhooks (content type <code>application/json</code>, event: <i>push</i>). Until then, the tracker polls GitHub every {Math.round(link.poll_seconds / 60) || 1} min for new commits.
          </p>
        )}
        <div className="mt-3 grid gap-2">
          {[['Payload URL', link.webhook.url], ['Secret', link.webhook.secret || '']].map(([label, value]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="w-24 text-[11px] font-semibold text-slate-500">{label}</span>
              <code className="flex-1 truncate text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700">{value}</code>
              <button onClick={() => copy(label, value)} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer" title={`Copy ${label}`}>
                {copied === label ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100">
        <button
          onClick={() => run('reanalyze', async () => { await syncGithub(projectId, true); onChanged(await getGithub(projectId)) })}
          className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
        >
          {busy === 'reanalyze' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Re-map commits to plan
        </button>
        <button onClick={() => setRelink((v) => !v)} className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl inline-flex items-center gap-1.5 cursor-pointer">
          <Link2 className="w-3.5 h-3.5" /> Change repository
        </button>
        <button
          onClick={() => {
            if (!confirm(`Unlink ${link.full_name}? Tracked commits and status will be removed from Devflow (nothing changes on GitHub).`)) return
            run('unlink', async () => { await unlinkGithub(projectId); onChanged(null) })
          }}
          className="px-3 py-2 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 font-semibold text-xs rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
        >
          {busy === 'unlink' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />} Unlink
        </button>
      </div>
      {actionError && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {actionError}
        </p>
      )}
      {relink && <LinkRepoForm projectId={projectId} canManage initialRepo={link.full_name} onLinked={(d) => { setRelink(false); onChanged(d) }} />}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Status tab
// ---------------------------------------------------------------------------
function ProgressRing({ percent }: { percent: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90">
      <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
      <circle cx="40" cy="40" r={r} fill="none" stroke="#2563eb" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * percent) / 100} />
    </svg>
  )
}

function StatusTab({ data }: { data: GithubOverview }) {
  const [filter, setFilter] = useState<'all' | GithubItemStatus | 'mismatch'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const items = data.items || []
  const p = data.progress!
  const report = data.report || {}
  const mismatches = items.filter((i) => i.mismatch).length
  const shown = items.filter((i) => (filter === 'all' ? true : filter === 'mismatch' ? !!i.mismatch : i.status === filter))
  const grouped = useMemo(() => {
    const g = new Map<string, GithubPlanItem[]>()
    shown.forEach((i) => g.set(i.epic, [...(g.get(i.epic) || []), i]))
    return [...g.entries()]
  }, [shown])

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="p-5 flex items-center gap-5">
          <div className="relative">
            <ProgressRing percent={p.percent} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-slate-900">{p.percent}%</span>
              <span className="text-[10px] text-slate-500 -mt-0.5">built</span>
            </div>
          </div>
          <div className="space-y-1.5 text-xs">
            {(['implemented', 'in_progress', 'not_started'] as GithubItemStatus[]).map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${STATUS_STYLE[s].pill}`}>{STATUS_STYLE[s].icon}{STATUS_STYLE[s].label}</span>
                <span className="font-bold text-slate-900">{p[s]}</span>
              </div>
            ))}
            <p className="text-[11px] text-slate-400 pt-1">of {p.total} plan items</p>
            <p className="text-[10px] text-slate-400 leading-snug max-w-[160px]">Observed from commits, not verified by tests or CI</p>
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" /> AI status summary
            {report.stale && (
              <span title="The last refresh failed (AI provider limit). Item statuses below are current; this text may lag behind." className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                May be out of date
              </span>
            )}
          </h3>
          {report.summary ? (
            <>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">{report.summary}</p>
              {!!report.tech_stack?.length && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {report.tech_stack.slice(0, 10).map((t) => <span key={t} className="text-[11px] font-medium bg-slate-100 text-slate-700 rounded-md px-2 py-0.5">{t}</span>)}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400 mt-2">
              {data.link?.sync_status === 'ready'
                ? 'Not generated yet: the AI provider was unavailable or rate-limited. It is retried automatically.'
                : 'The summary appears after the first sync completes.'}
            </p>
          )}
        </Card>
      </div>

      {(!!report.highlights?.length || !!report.gaps?.length) && (
        <div className="grid md:grid-cols-2 gap-5">
          {!!report.highlights?.length && (
            <Card className="p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Recent highlights</h4>
              <ul className="space-y-1.5 text-sm text-slate-700 list-disc pl-5">{report.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
            </Card>
          )}
          {!!report.gaps?.length && (
            <Card className="p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Gaps & risks</h4>
              <ul className="space-y-1.5 text-sm text-slate-700 list-disc pl-5">{report.gaps.map((h) => <li key={h}>{h}</li>)}</ul>
            </Card>
          )}
        </div>
      )}

      {!!data.epics?.length && (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Progress by epic</h3>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-3">
            {data.epics.map((e) => (
              <div key={e.epic}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 truncate pr-2">{e.epic}</span>
                  <span className="text-slate-500 shrink-0">{e.implemented}/{e.total} done · {e.percent}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                  <div className="bg-emerald-500" style={{ width: `${(100 * e.implemented) / e.total}%` }} />
                  <div className="bg-amber-400" style={{ width: `${(100 * e.in_progress) / e.total}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">Plan items vs. code</h3>
          <div className="flex flex-wrap gap-1.5">
            {([['all', `All ${items.length}`], ['implemented', 'Likely complete'], ['in_progress', 'In progress'], ['not_started', 'Not started'], ['mismatch', `Board mismatch ${mismatches}`]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer ${filter === key ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 text-center">This project has no backlog tasks or requirements yet, so there is nothing to map commits onto. Generate the plan first, then use "Re-map commits to plan".</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {grouped.map(([epic, list]) => (
              <div key={epic}>
                <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{epic}</p>
                {list.map((item) => (
                  <div key={item.key} className="px-4 py-2.5">
                    <button onClick={() => setOpen(open === item.key ? null : item.key)} className="w-full flex items-center gap-3 text-left cursor-pointer">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 w-[108px] ${STATUS_STYLE[item.status].pill}`}>{STATUS_STYLE[item.status].icon}{STATUS_STYLE[item.status].label}</span>
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-800">{item.title}</span>
                        <span className="ml-2 text-[10px] text-slate-400 font-mono">{item.key}</span>
                        {item.mismatch && <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"><AlertTriangle className="w-3 h-3" /> board mismatch</span>}
                      </span>
                      {item.board_status && <span className="hidden md:inline text-[11px] text-slate-500 shrink-0">Board: {item.board_status}</span>}
                      <span className="flex -space-x-1.5 shrink-0">
                        {item.contributors.slice(0, 4).map((c) => <Avatar key={c.key} src={c.avatar_url} name={c.name} />)}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open === item.key ? 'rotate-180' : ''}`} />
                    </button>
                    {open === item.key && (
                      <div className="mt-2 ml-[120px] space-y-1.5">
                        {item.verdict_reason && <p className="text-xs text-slate-600 flex items-start gap-1.5"><Sparkles className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" /> {item.verdict_reason}</p>}
                        {item.mismatch && <p className="text-xs text-amber-700">{item.mismatch}</p>}
                        {item.commits.length === 0 ? (
                          <p className="text-xs text-slate-400">No commits mapped to this item yet.</p>
                        ) : item.commits.map((c) => (
                          <a key={c.sha} href={c.url || '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-slate-600 hover:text-blue-600">
                            <code className="text-[11px] text-slate-500">{c.sha.slice(0, 7)}</code>
                            <span className="truncate">{c.message}</span>
                            <span className="text-slate-400 shrink-0">· {c.author} · {timeAgo(c.committed_at)}</span>
                            {c.completion === 'complete' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------
function ActivityTab({ projectId, data, refreshKey }: { projectId: string; data: GithubOverview; refreshKey: string }) {
  const [author, setAuthor] = useState('')
  const [commits, setCommits] = useState<GithubCommit[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const titles = useMemo(() => Object.fromEntries((data.items || []).map((i) => [i.key, i.title])), [data.items])
  const requestId = useRef(0)

  const load = useCallback(async (offset: number) => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await listGithubCommits(projectId, { limit: 40, offset, author: author || undefined })
      if (id !== requestId.current) return // a newer filter/refresh superseded this request
      setCommits((prev) => (offset ? [...prev, ...res.commits] : res.commits))
      setHasMore(res.commits.length === 40)
    } catch {
      if (id === requestId.current) setHasMore(false)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [projectId, author])

  useEffect(() => { load(0) }, [load, refreshKey])

  const cats = data.stats?.categories || {}
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <span key={c} className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 ${CATEGORY_STYLE[c] || CATEGORY_STYLE.chore}`}>{c} · {n}</span>
          ))}
        </div>
        <select value={author} onChange={(e) => setAuthor(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          <option value="">All contributors</option>
          {(data.contributors || []).map((c) => <option key={c.key} value={c.key}>{c.name}{c.login ? ` (@${c.login})` : ''}</option>)}
        </select>
      </div>
      <Card className="divide-y divide-slate-100">
        {commits.map((c) => {
          const a = c.analysis || {}
          const name = c.author_login || c.author_name || 'Unknown'
          return (
            <div key={c.sha} className="p-4 flex gap-3">
              <Avatar src={c.author_avatar} name={name} size="w-8 h-8" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 ${CATEGORY_STYLE[a.category || 'chore'] || CATEGORY_STYLE.chore}`}>{a.category || 'pending'}</span>
                  {a.area && <span className="text-[11px] text-slate-500">{a.area}</span>}
                  <span className="text-[11px] text-slate-400 ml-auto">{timeAgo(c.committed_at)}</span>
                </div>
                <p className="text-sm text-slate-700 mt-0.5">{a.summary || c.message.split('\n')[0]}</p>
                {a.summary && a.summary !== c.message.split('\n')[0] && <p className="text-xs text-slate-400 mt-0.5 truncate">“{c.message.split('\n')[0]}”</p>}
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <a href={c.url || '#'} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-slate-500 hover:text-blue-600">{c.sha.slice(0, 7)}</a>
                  {(c.additions > 0 || c.deletions > 0) && <span className="text-[11px]"><span className="text-emerald-600">+{c.additions}</span> <span className="text-rose-600">−{c.deletions}</span></span>}
                  {(a.items || []).map((m) => (
                    <span key={m.key} className={`text-[11px] rounded-md px-1.5 py-0.5 border ${m.completion === 'complete' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                      {m.completion === 'complete' ? '✓ ' : '◐ '}{titles[m.key] || m.key}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
        {!loading && commits.length === 0 && <p className="p-6 text-sm text-slate-500 text-center">No commits tracked yet.</p>}
        {loading && <div className="p-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>}
      </Card>
      {hasMore && !loading && (
        <button onClick={() => load(commits.length)} className="mx-auto block px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer">Load more</button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Contributors tab
// ---------------------------------------------------------------------------
function ContributorsTab({ contributors }: { contributors: GithubContributor[] }) {
  const maxCommits = Math.max(1, ...contributors.map((c) => c.commits))
  if (!contributors.length) return <Card className="p-6 text-sm text-slate-500 text-center">No contributors yet.</Card>
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {contributors.map((c) => {
        const cats = Object.entries(c.categories).sort((a, b) => b[1] - a[1])
        return (
          <Card key={c.key} className="p-5">
            <div className="flex items-center gap-3">
              <Avatar src={c.avatar_url} name={c.name} size="w-11 h-11" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900 truncate">{c.name}</p>
                {c.login && <a href={`https://github.com/${c.login}`} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-blue-600">@{c.login}</a>}
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-slate-900">{c.commits}</p>
                <p className="text-[10px] text-slate-500 -mt-0.5">commits</p>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 mt-3 overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${(100 * c.commits) / maxCommits}%` }} /></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
              {c.has_line_stats && <span><span className="text-emerald-600 font-semibold">+{c.additions.toLocaleString()}</span> / <span className="text-rose-600 font-semibold">−{c.deletions.toLocaleString()}</span> lines</span>}
              <span>Active {c.first_commit ? new Date(c.first_commit).toLocaleDateString() : '?'} → {timeAgo(c.last_commit)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {cats.map(([cat, n]) => <span key={cat} className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 ${CATEGORY_STYLE[cat] || CATEGORY_STYLE.chore}`}>{cat} {n}</span>)}
            </div>
            {!!c.top_areas.length && <p className="text-[11px] text-slate-500 mt-2">Works in: {c.top_areas.join(', ')}</p>}
            {(c.delivered.length > 0 || c.touched.length > 0) && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                {c.delivered.slice(0, 5).map((d) => <p key={d.key} className="text-xs text-slate-700 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> {d.title}</p>)}
                {c.touched.slice(0, 3).map((d) => <p key={d.key} className="text-xs text-slate-500 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" /> {d.title}</p>)}
                {c.delivered.length + c.touched.length > 8 && <p className="text-[11px] text-slate-400">+{c.delivered.length + c.touched.length - 8} more</p>}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat tab
// ---------------------------------------------------------------------------
const SUGGESTIONS = [
  'Give me a summary of this repository',
  'What has been implemented so far, and what is still missing?',
  'Who built which features?',
  'What changed in the last week?',
  'How is the codebase structured?',
]

function ChatTab({ projectId, repoName }: { projectId: string; repoName: string }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages, busy])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    const history = messages
    setMessages([...history, { role: 'user', content: message }])
    setInput('')
    setBusy(true)
    try {
      const res = await askRepo(projectId, message, history)
      setMessages((m) => [...m, { role: 'assistant', content: res.reply || 'No answer returned.' }])
    } catch (err: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `Sorry, the repo assistant is unavailable right now (${String(err?.message || err)}).` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col h-[min(70vh,640px)]" >
      <div className="p-4 border-b border-slate-100 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center"><Bot className="w-4 h-4" /></div>
        <div>
          <p className="text-sm font-bold text-slate-900">Ask the repo</p>
          <p className="text-[11px] text-slate-500">Grounded in {repoName}: code structure, commits, contributors, and plan status</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm" data-testid="repo-chat-messages">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <MessageSquare className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500 mb-4">Ask anything about the repository.</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-slate-600 cursor-pointer">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-50 border border-slate-200 text-slate-700'}`}>
              {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 rounded-2xl bg-slate-100 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-600 w-fit">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the repository…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="p-3 border-t border-slate-100 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Who implemented authentication?"
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          name="repo-question"
        />
        <button type="submit" disabled={busy || !input.trim()} className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl cursor-pointer" aria-label="Send">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Root view
// ---------------------------------------------------------------------------
export function GithubView() {
  const projectId = useProjectStore((s) => s.projectId)
  const [data, setData] = useState<GithubOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('status')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const activeProject = useRef(projectId)
  activeProject.current = projectId

  const refresh = useCallback(async () => {
    if (!projectId || inFlight.current) return
    inFlight.current = true
    try {
      const next = await getGithub(projectId)
      if (activeProject.current !== projectId) return // project switched mid-request
      setData(next)
      setError(null)
    } catch (err: any) {
      if (activeProject.current === projectId) setError(String(err?.message || err))
    } finally {
      inFlight.current = false
    }
  }, [projectId])

  useEffect(() => {
    setData(null)
    setTab('status')
    setSettingsOpen(false)
    refresh()
  }, [refresh])

  // Poll quickly while a sync runs, slowly otherwise so pushes show up on their own.
  const syncing = data?.link?.sync_status === 'syncing' || data?.link?.sync_status === 'pending'
  useEffect(() => {
    if (!data?.linked) return
    const id = setInterval(refresh, syncing ? 3000 : 30000)
    return () => clearInterval(id)
  }, [data?.linked, syncing, refresh])

  if (!projectId) return null
  if (error && !data) {
    return <Card className="p-6 text-sm text-rose-700">Could not load GitHub tracking: {error}</Card>
  }
  if (!data) {
    return <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  }

  const canManage = data.role === 'manager'
  const canSync = data.role === 'manager' || data.role === 'developer'

  if (!data.linked) {
    return (
      <div className="space-y-5">
        <Header />
        <NotLinked projectId={projectId} canManage={canManage} onLinked={(d) => setData(d)} />
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { id: 'status', label: 'Implementation status', icon: <CheckCircle2 className="w-4 h-4" /> },
    { id: 'activity', label: 'Commit activity', icon: <GitCommitHorizontal className="w-4 h-4" />, count: data.stats?.commits },
    { id: 'contributors', label: 'Contributors', icon: <Users className="w-4 h-4" />, count: data.contributors?.length },
    { id: 'chat', label: 'Ask the repo', icon: <Bot className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-5">
      <Header />
      <RepoHeader
        data={data}
        canSync={canSync}
        canManage={canManage}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        onSync={async () => {
          setActionError(null)
          try {
            await syncGithub(projectId)
          } catch (err: any) {
            setActionError(String(err?.message || err).replace(/^\d+:\s*/, ''))
          }
          refresh()
        }}
      />
      {actionError && <Card className="p-3 text-xs text-rose-700 border-rose-200 bg-rose-50">{actionError}</Card>}
      {settingsOpen && canManage && (
        <SettingsPanel data={data} projectId={projectId} onChanged={(d) => { if (d) setData(d); else { setSettingsOpen(false); refresh() } }} />
      )}
      {syncing && (data.stats?.commits ?? 0) === 0 ? (
        <Card className="p-10 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="font-semibold text-slate-900">Importing commits and mapping them to your plan…</p>
          <p className="text-xs text-slate-500 mt-1">This usually takes under a minute for the first sync.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 bg-slate-100/80 p-1 rounded-xl w-fit">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${tab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
                {t.icon} {t.label}
                {t.count != null && <span className="text-[10px] bg-slate-200/80 text-slate-600 rounded px-1.5">{t.count}</span>}
              </button>
            ))}
          </div>
          {tab === 'status' && <StatusTab data={data} />}
          {tab === 'activity' && <ActivityTab projectId={projectId} data={data} refreshKey={`${data.link?.head_sha}|${data.report?.generated_at}`} />}
          {tab === 'contributors' && <ContributorsTab contributors={data.contributors || []} />}
          {tab === 'chat' && <ChatTab key={projectId} projectId={projectId} repoName={data.link!.full_name} />}
        </>
      )}
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Github className="w-6 h-6" /> GitHub Tracker</h1>
      <p className="text-sm text-slate-500 mt-0.5">What has actually been built, who built it, and what the codebase contains — updated on every push.</p>
    </div>
  )
}

'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Clock,
  FolderKanban,
  LayoutDashboard,
  Plus,
  Search,
  Sparkles,
  ArrowRight,
  ChevronRight,
  Layers,
  Users,
  DollarSign,
  ShieldCheck,
  Zap,
  RotateCw,
} from 'lucide-react'
import { listProjects, retryProject } from '@/lib/api'
import type { ProjectDoc } from '@/lib/project-types'
import { TopNavbar } from '@/components/layout/top-navbar'
import { AccountPanel } from '@/components/layout/account-panel'
import { useAppUser } from '@/lib/auth-context'

type ProjectSummary = Partial<ProjectDoc> & { project_role?: string, project_specialization?: string }

const TEMPLATE_IDEAS = [
  'AI-powered recruitment portal for tech startups',
  'Real-time collaborative canvas for product teams',
  'B2B SaaS subscription and billing dashboard',
  'Cross-platform telemedicine patient scheduling app',
]

export function ProjectsHub() {
  const { user } = useAppUser()
  const router = useRouter()
  const [quickIdea, setQuickIdea] = useState('')

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickIdea.trim()) return
    router.push(`/projects/new?idea=${encodeURIComponent(quickIdea.trim())}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <TopNavbar />
      <AccountPanel />

      <main className="flex-1 relative z-10 pt-24 pb-16 px-4 sm:px-6 max-w-7xl mx-auto w-full space-y-8">
        {/* Welcome & Quick Action Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-semibold tracking-wide">
                <FolderKanban className="w-3.5 h-3.5" /> Workspace Hub
              </span>
              {user?.firstName && (
                <span className="text-xs text-slate-400 font-medium">· Welcome back, {user.firstName}</span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              My Projects
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm mt-1">
              Create a new project or select an existing project to view architecture, backlog, and team collaboration.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* My Tasks quick link */}
            <Link href="/my-tasks">
              <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-700 font-semibold text-xs transition-colors shadow-xs cursor-pointer">
                <Zap className="w-4 h-4 text-indigo-500" />
                My Tasks
              </button>
            </Link>
            {/* Anyone can create a project and becomes its manager */}
            <Link href="/projects/new">
              <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-semibold text-xs transition-colors shadow-sm cursor-pointer">
                <Plus className="w-4 h-4" />
                New Project
              </button>
            </Link>
          </div>
        </div>

        {/* Quick Intake Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">Have a new idea to plan?</h2>
          </div>
          <form onSubmit={handleQuickSubmit} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={quickIdea}
              onChange={(e) => setQuickIdea(e.target.value)}
              placeholder="e.g. AI-powered recruitment platform with automated screening and scheduling..."
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 bg-slate-50/50 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
            <button
              type="submit"
              disabled={!quickIdea.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-semibold text-xs transition-colors shadow-xs shrink-0 cursor-pointer"
            >
              Plan with AI <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-slate-400 font-medium mr-1">Try template:</span>
            {TEMPLATE_IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setQuickIdea(idea)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 font-medium transition-colors cursor-pointer"
              >
                {idea}
              </button>
            ))}
          </div>
        </div>

        {/* Projects List & Filters */}
        <ProjectsSection userId={user?.id ?? null} />
      </main>
    </div>
  )
}


function ProjectsSection({ userId }: { userId: string | null }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'ready' | 'active' | 'failed'>('all')
  const router = useRouter()

  useEffect(() => {
    // Reset state immediately when user changes so stale data is never shown
    setProjects([])
    setLoading(true)
    setError(null)

    // Don't fetch until we know who the user is
    if (!userId) return

    let mounted = true
    listProjects()
      .then((res) => {
        if (!mounted) return
        setProjects(res.projects || [])
        setLoading(false)
      })
      .catch((err) => {
        if (!mounted) return
        setError(err.message || 'Failed to load projects')
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [userId])

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchQuery =
        !query ||
        p.title?.toLowerCase().includes(query.toLowerCase()) ||
        p.idea?.toLowerCase().includes(query.toLowerCase())

      if (!matchQuery) return false

      if (filter === 'ready') return p.status === 'complete'
      if (filter === 'active') return p.status === 'running' || p.status === 'queued' || p.status === 'awaiting_approval'
      if (filter === 'failed') return p.status === 'failed'
      return true
    })
  }, [projects, query, filter])

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 rounded-2xl bg-white border border-slate-200 animate-pulse shadow-xs" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-white border border-rose-200 rounded-2xl shadow-xs">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-3" />
        <h3 className="text-rose-700 font-bold text-sm">Failed to load projects</h3>
        <p className="text-slate-500 text-xs mt-1">{error}</p>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="py-16 px-4 text-center bg-white border border-slate-200 rounded-2xl shadow-xs max-w-2xl mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center mx-auto mb-4">
          <LayoutDashboard className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">
          No projects yet
        </h3>
        <p className="text-slate-500 text-xs sm:text-sm mt-1 max-w-md mx-auto mb-6">
          Start your first autonomous AI orchestration. Plan requirements, backlog, system architecture, team, cost, and timelines.
        </p>
        <Link href="/projects/new">
          <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-semibold text-xs transition-colors shadow-xs cursor-pointer">
            <Plus className="w-4 h-4" /> Create Your First Project
          </button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shrink-0">
          {(['all', 'ready', 'active', 'failed'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg capitalize transition-colors cursor-pointer ${
                filter === tab
                  ? 'bg-blue-50 text-blue-700 border border-blue-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filteredProjects.length === 0 ? (
        <div className="py-12 text-center bg-white border border-slate-200 rounded-2xl">
          <p className="text-slate-500 text-xs">No projects match your search criteria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/workspace?project=${p.id}`)}
              className="group flex flex-col p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-blue-400 hover:shadow-md cursor-pointer transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                  {p.title || 'Untitled Project'}
                </h3>
                <StatusBadge status={p.status} />
              </div>
              
              <div className="flex items-center gap-2 mb-3">
                {p.project_role && (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    p.project_role === 'manager' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    p.project_role === 'developer' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                    'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                    {p.project_role}
                  </span>
                )}
                {p.project_specialization && (
                  <span className="text-[10px] font-medium text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full">
                    {p.project_specialization}
                  </span>
                )}
              </div>

              <p className="text-slate-500 text-xs line-clamp-2 mb-4 leading-relaxed flex-1">
                {p.idea || 'Autonomous AI delivery specification'}
              </p>

              {p.error && (p.status === 'failed' || p.status === 'queued') && (
                <RunIssue
                  project={p}
                  onRetried={() =>
                    setProjects((all) =>
                      all.map((x) => (x.id === p.id ? { ...x, status: 'queued', error: null } : x)),
                    )
                  }
                />
              )}

              <div className="space-y-3 pt-3 border-t border-slate-100 mt-auto">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                    <span>Orchestration Progress</span>
                    <span className="font-bold text-slate-900">{Math.floor(p.progress || 0)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden border border-slate-200/60">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-500"
                      style={{ width: `${p.progress || 0}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {p.created_at
                        ? new Date(p.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Recently'}
                    </span>
                  </div>

                  <span className="inline-flex items-center gap-1 font-semibold text-blue-600 group-hover:translate-x-0.5 transition-transform">
                    Open Workspace <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RunIssue({ project, onRetried }: { project: ProjectSummary; onRetried: () => void }) {
  const [busy, setBusy] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const failed = project.status === 'failed'

  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!project.id || busy) return
    setBusy(true)
    setRetryError(null)
    try {
      await retryProject(project.id)
      onRetried()
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`mb-4 rounded-lg border px-3 py-2 text-[11px] cursor-default ${failed ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className={`w-3.5 h-3.5 mt-px shrink-0 ${failed ? 'text-rose-600' : 'text-amber-600'}`} />
        <span className="line-clamp-3 break-words">{project.error}</span>
      </div>
      {failed && (
        <button
          onClick={retry}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-semibold transition-colors cursor-pointer"
        >
          <RotateCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Resuming…' : 'Retry from where it stopped'}
        </button>
      )}
      {retryError && <p className="mt-1.5 text-rose-700">{retryError}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string | undefined }) {
  if (status === 'complete') {
    return (
      <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full shrink-0">
        Ready
      </span>
    )
  }

  if (status === 'failed') {
    return (
      <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 rounded-full shrink-0">
        Failed
      </span>
    )
  }

  if (status === 'stopped') {
    return (
      <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-300 rounded-full shrink-0">
        Stopped
      </span>
    )
  }

  if (status === 'awaiting_approval') {
    return (
      <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 rounded-full shrink-0">
        Needs approval
      </span>
    )
  }

  return (
    <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 rounded-full shrink-0 flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
      Active
    </span>
  )
}


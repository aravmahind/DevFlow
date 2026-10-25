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
  ChevronRight,
  Layers,
  Users,
  DollarSign,
  ShieldCheck,
  RotateCw,
  Trash2,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { listProjects, retryProject, deleteProject } from '@/lib/api'
import type { ProjectDoc } from '@/lib/project-types'
import { TopNavbar } from '@/components/layout/top-navbar'
import { AccountPanel } from '@/components/layout/account-panel'
import { useAppUser } from '@/lib/auth-context'

type ProjectSummary = Partial<ProjectDoc> & { project_role?: string, project_specialization?: string }

export function ProjectsHub() {
  const { user } = useAppUser()

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
            {/* Prominently Highlighted New Project button */}
            <Link href="/projects/new">
              <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg hover:shadow-blue-500/25 ring-2 ring-blue-500/30 transition-all duration-200 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0">
                <Plus className="w-4 h-4 stroke-[2.5]" />
                New Project
              </button>
            </Link>
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
  const [projectToDelete, setProjectToDelete] = useState<ProjectSummary | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
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

  const handleConfirmDelete = async () => {
    if (!projectToDelete?.id) return
    const id = projectToDelete.id
    const title = projectToDelete.title || 'Untitled Project'
    setDeletingId(id)
    setDeleteError(null)
    try {
      await deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      setProjectToDelete(null)
      setToastMessage(`Project "${title}" was permanently deleted.`)
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err: any) {
      setDeleteError(err?.message?.replace(/^\d+:\s*/, '') || 'Failed to delete project')
    } finally {
      setDeletingId(null)
    }
  }

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
      {/* Toast Notification */}
      {toastMessage && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-800 animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

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
          {filteredProjects.map((p, pIdx) => (
            <div
              key={p.id ? `${p.id}-${pIdx}` : `proj-${pIdx}`}
              onClick={() => router.push(`/workspace?project=${p.id}`)}
              className="group flex flex-col p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-blue-400 hover:shadow-md cursor-pointer transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1 flex-1">
                  {p.title || 'Untitled Project'}
                </h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  <StatusBadge status={p.status} />
                  {(!p.project_role || p.project_role === 'manager') && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setProjectToDelete(p)
                        setDeleteError(null)
                      }}
                      className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete project completely"
                      aria-label={`Delete ${p.title || 'project'}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
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

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => !deletingId && setProjectToDelete(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Delete Project</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  This action is permanent and cannot be undone.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-600 space-y-1.5">
              <p>
                Are you sure you want to completely delete{' '}
                <span className="font-bold text-slate-900">
                  &ldquo;{projectToDelete.title || 'Untitled Project'}&rdquo;
                </span>
                ?
              </p>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                All AI requirements, architecture designs, sprint backlog tasks, risks, and member history will be permanently deleted from the database.
              </p>
            </div>

            {deleteError && (
              <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={() => setProjectToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={handleConfirmDelete}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                {deletingId ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Project Completely</span>
                  </>
                )}
              </button>
            </div>
          </div>
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


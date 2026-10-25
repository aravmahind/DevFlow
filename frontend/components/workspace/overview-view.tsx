'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectStore } from '@/lib/project-store'
import { useAppStore, type WorkspaceMode } from '@/lib/store'
import { approveProject, getProject, deleteProject } from '@/lib/api'
import { useProjectRole } from '@/components/auth/permission-guard'
import { InlineEditable } from './workspace-editor'
import {
  Target, Clock, Users, Sparkles, CheckCircle2,
  DollarSign, ShieldAlert, Flag, TrendingUp, Loader2,
  Trash2, AlertCircle,
} from 'lucide-react'
import { RunControls, AgentWorkingBadge } from './run-controls'

export function OverviewView() {
  const router = useRouter()
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const role = useProjectRole()
  const exec = project?.executive_summary || null

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDeleteProject = async () => {
    if (!project?.id) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProject(project.id)
      router.push('/my-projects')
    } catch (err: any) {
      setDeleteError(err?.message?.replace(/^\d+:\s*/, '') || 'Failed to delete project')
      setDeleting(false)
    }
  }

  const title = exec?.project_title || project?.title || 'New Project'
  const subtitle = exec?.tagline || exec?.overview || project?.idea || 'Your AI-generated delivery plan'

  const reqCount =
    (project?.requirements?.functional_requirements?.length || 0) +
    (project?.requirements?.non_functional_requirements?.length || 0)
  const taskCount = project?.backlog?.tasks?.length || 0
  const sprintCount = project?.backlog?.sprints?.length || 0
  const riskCount = project?.risks?.risks?.length || 0
  const milestoneCount = project?.timeline?.milestones?.length || 0
  const teamCount = (project?.team?.members || []).reduce((sum, m) => sum + (m.count || 1), 0)
  const projectCost = project?.cost?.project_total_usd || 0
  const riskLevel = project?.risks?.overall_risk_level || '—'

  const fmtMoney = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `$${n}`

  const fr = project?.requirements?.functional_requirements?.length || 0
  const nfr = project?.requirements?.non_functional_requirements?.length || 0
  const stories = project?.requirements?.user_stories?.length || 0

  const snapshot = [
    { icon: Clock, label: 'Duration', value: exec ? `${exec.estimated_duration_weeks}w` : '—' },
    { icon: Users, label: 'Team roles', value: teamCount ? `${teamCount}` : (exec ? `${exec.recommended_team_size}` : '—') },
    { icon: DollarSign, label: 'Budget', value: projectCost ? fmtMoney(projectCost) : '—' },
    { icon: ShieldAlert, label: 'Risk level', value: riskLevel },
    { icon: Flag, label: 'Sprints', value: sprintCount || '—' },
    { icon: TrendingUp, label: 'Milestones', value: milestoneCount || '—' },
  ]

  // A section that hasn't been generated shows "—" with why, never a made-up number.
  const stats = [
    { label: 'Plan complete', value: `${project?.progress ?? 0}`, unit: '%', sub: status === 'complete' ? 'All phases done' : 'Across 6 phases' },
    { label: 'Requirements', value: fr + nfr + stories ? `${fr + nfr + stories}` : '—', sub: fr + nfr + stories ? `${fr} functional · ${nfr} non-functional · ${stories} stories` : 'Drafted first' },
    { label: 'Tasks', value: taskCount ? `${taskCount}` : '—', sub: taskCount ? `${sprintCount} sprints` : 'After sprint planning' },
    { label: 'Open risks', value: riskCount ? `${riskCount}` : '—', sub: riskCount ? `Overall ${riskLevel}` : 'Assessed after sprints' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h1 className="text-3xl font-semibold text-slate-950 tracking-tight"><InlineEditable path="/executive_summary/project_title" value={title} /></h1>
            <StatusPill status={status} />
          </div>
          <p className="text-slate-600 text-[15px] leading-relaxed max-w-2xl"><InlineEditable path={exec?.tagline ? '/executive_summary/tagline' : '/idea'} value={subtitle} multiline /></p>
        </div>
        {exec && (
          <div className="text-right shrink-0">
            <p className="text-xs text-slate-500">Complexity</p>
            <p className="text-2xl font-semibold text-slate-950 tabular-nums leading-tight">
              {exec.complexity_score}<span className="text-sm text-slate-400 font-normal">/100</span>
            </p>
            <p className="text-xs text-slate-600">{exec.complexity_label}</p>
          </div>
        )}
      </div>

      {/* Headline numbers */}
      <section aria-label="Plan stats" className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-2xl overflow-hidden divide-x divide-y lg:divide-y-0 divide-slate-200">
        {stats.map((stat) => (
          <div key={stat.label} className="p-5">
            <p className="text-[13px] text-slate-500">{stat.label}</p>
            <p className={`mt-1.5 text-4xl font-semibold tracking-tight tabular-nums leading-none ${stat.value === '—' ? 'text-slate-300' : 'text-slate-950'}`}>
              {stat.value}{stat.value !== '—' && stat.unit && <span className="text-xl text-slate-400">{stat.unit}</span>}
            </p>
            <p className="mt-2 text-xs text-slate-500">{stat.sub}</p>
          </div>
        ))}
      </section>

      <ApprovalBanner />
      <PipelineTrack />

      {exec?.vision && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-700 leading-relaxed">
          <span className="font-semibold text-slate-950 block mb-1 text-xs uppercase tracking-wider">Vision</span>
          <InlineEditable path="/executive_summary/vision" value={exec.vision} multiline />
        </div>
      )}

      {/* Delivery snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {snapshot.map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 p-4 rounded-xl">
            <s.icon className="w-4 h-4 text-slate-500" />
            <p className="mt-2 text-xl font-semibold text-slate-950 leading-none tabular-nums">{s.value}</p>
            <p className="text-xs text-slate-500 mt-1.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 4 Detail Panels */}
      {exec ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Business Goals" icon={Target} items={exec.business_goals} pathPrefix="/executive_summary/business_goals" />
            <Panel title="Success Criteria" icon={CheckCircle2} items={exec.success_criteria} pathPrefix="/executive_summary/success_criteria" />
            <Panel title="Target Users & Personas" icon={Users} items={exec.target_users} pathPrefix="/executive_summary/target_users" />
            <Panel title="Key Differentiators" icon={Sparkles} items={exec.key_differentiators} pathPrefix="/executive_summary/key_differentiators" />
          </div>

          {(exec.competitive_landscape || exec.go_to_market) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {exec.competitive_landscape && (
                <div className="bg-white border border-slate-200 p-5 sm:p-6 rounded-xl shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Competitive Landscape</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <InlineEditable path="/executive_summary/competitive_landscape" value={exec.competitive_landscape} multiline />
                  </p>
                </div>
              )}
              {exec.go_to_market && (
                <div className="bg-white border border-slate-200 p-5 sm:p-6 rounded-xl shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Go-To-Market Strategy</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <InlineEditable path="/executive_summary/go_to_market" value={exec.go_to_market} multiline />
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <GeneratingPanel label="Executive Summary" />
      )}

      {/* Danger Zone: Delete Project (Managers only) */}
      {(!role || role === 'manager') && (
        <div className="border border-rose-200/80 bg-rose-50/40 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8">
          <div>
            <h3 className="font-bold text-sm text-rose-950 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-600" /> Delete Project
            </h3>
            <p className="text-xs text-rose-700/80 mt-1 max-w-xl leading-relaxed">
              Permanently delete this project and all its specifications, backlog tasks, sprint schedules, and team assignments. This action cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowDeleteModal(true)
              setDeleteError(null)
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Project Completely
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => !deleting && setShowDeleteModal(false)}
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
                  &ldquo;{project?.title || title || 'this project'}&rdquo;
                </span>
                ?
              </p>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                All AI requirements, architecture designs, sprint backlog tasks, risks, and member history will be permanently erased.
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
                disabled={deleting}
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteProject}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                {deleting ? (
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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    running: { label: 'Agents working', cls: 'bg-slate-950 text-white border-slate-950', dot: 'bg-signal signal-pulse' },
    queued: { label: 'Queued', cls: 'bg-slate-950 text-white border-slate-950', dot: 'bg-signal' },
    awaiting_approval: { label: 'Needs your approval', cls: 'bg-slate-950 text-white border-slate-950', dot: 'bg-signal' },
    complete: { label: 'Plan ready', cls: 'bg-white text-slate-800 border-slate-200', dot: 'bg-slate-950' },
    stopped: { label: 'Stopped', cls: 'bg-white text-slate-700 border-slate-200', dot: 'bg-slate-400' },
    failed: { label: 'Run failed', cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  }
  const s = map[status] || map.complete
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {s.label}
    </span>
  )
}

const PHASES: { node: string; label: string; mode: WorkspaceMode }[] = [
  { node: 'requirements', label: 'Requirements', mode: 'requirements' },
  { node: 'architecture', label: 'Architecture', mode: 'architecture' },
  { node: 'sprint_planning', label: 'Sprint plan', mode: 'sprint' },
  { node: 'execution', label: 'GitHub', mode: 'github' },
  { node: 'risk', label: 'Risk', mode: 'risks' },
  { node: 'deployment', label: 'Deployment', mode: 'integrations' },
]

/** Six phases as one track: done (solid), waiting on you (hatched), running (pulse), queued. */
function PipelineTrack() {
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const nodes = (project?.orchestration?.nodes || {}) as Record<string, { status?: string }>
  const pending = project?.pending_approval
  const states = PHASES.map((p) => {
    const st = nodes[p.node]?.status
    if (status === 'awaiting_approval' && pending && pendingPhaseNode(pending) === p.node) return 'waiting'
    if (st === 'complete') return 'done'
    if (st === 'failed') return 'failed'
    if (st && st !== 'idle') return 'running'
    return 'queued'
  })
  const caption: Record<string, string> = { done: 'done', waiting: 'waiting on you', running: 'running', failed: 'failed', queued: 'queued' }
  return (
    <section aria-label="Pipeline" className="space-y-3 bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">Agent Pipeline</span>
          <AgentWorkingBadge />
        </div>
        <RunControls />
      </div>
      <div className="grid grid-cols-6 gap-1.5 pt-1">
        {states.map((st, i) => (
          <span
            key={PHASES[i].node}
            className={`h-1.5 rounded-full ${
              st === 'done' ? 'bg-slate-950'
              : st === 'running' ? 'bg-slate-950 signal-pulse'
              : st === 'failed' ? 'bg-rose-500'
              : st === 'waiting' ? 'outline outline-1 -outline-offset-1 outline-slate-950 bg-[repeating-linear-gradient(90deg,#0a0a0a_0_6px,transparent_6px_10px)]'
              : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {PHASES.map((p, i) => (
          <span key={p.node} className="min-w-0">
            <span className={`block text-[13px] truncate ${states[i] === 'queued' ? 'text-slate-400' : 'text-slate-950 font-medium'}`}>{p.label}</span>
            <span className="block font-mono text-[11px] text-slate-500">{caption[states[i]]}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

function pendingPhaseNode(pending: string): string {
  return pending === 'sprint_review' ? 'execution' : pending
}

/** Dark glass banner whenever the run is parked at an approval gate. */
function ApprovalBanner() {
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const setProject = useProjectStore((s) => s.setProject)
  const setMode = useAppStore((s) => s.setActiveWorkspaceMode)
  const role = useProjectRole()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = project?.pending_approval
  if (status !== 'awaiting_approval' || !pending || !project) return null
  const phase = PHASES.find((p) => p.node === pendingPhaseNode(pending))
  const label = phase?.label.toLowerCase() || pending.replace(/_/g, ' ')

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      await approveProject(project.id, pending, true, '')
      setProject(await getProject(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Approval failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Approval needed" className="liquid-glass-dark rounded-2xl px-6 py-5 flex flex-wrap items-center justify-between gap-5">
      <div className="flex gap-4 items-start min-w-0 flex-[1_1_420px]">
        <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-signal signal-pulse shrink-0" />
        <div className="space-y-1">
          <p className="font-mono text-xs tracking-wide text-signal uppercase">Awaiting you · {label}</p>
          <p className="text-lg font-semibold tracking-tight">The {label} is ready for your review</p>
          <p className="text-sm text-neutral-400">Approve to let the next agent start, or review it and send changes back.</p>
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {role === 'manager' && (
          <button onClick={approve} disabled={busy} className="inline-flex items-center gap-2 bg-signal text-slate-950 font-semibold text-sm px-5 min-h-11 rounded-full disabled:opacity-60 cursor-pointer">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}Approve
          </button>
        )}
        <button onClick={() => phase && setMode(phase.mode)} className="inline-flex items-center text-white font-semibold text-sm px-5 min-h-11 rounded-full border border-white/20 hover:bg-white/10 cursor-pointer">
          Review {label}
        </button>
      </div>
    </section>
  )
}

function Panel({ title, icon: Icon, items, pathPrefix }: { title: string; icon: any; items: string[]; pathPrefix?: string }) {
  return (
    <div className="bg-white border border-slate-200 p-5 sm:p-6 rounded-xl shadow-xs">
      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-500" />
        {title}
      </h3>
      <ul className="space-y-2.5">
        {(items || []).map((item, idx) => (
          <li key={idx} className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-950 flex-shrink-0" />
            <span className="flex-1">
              {pathPrefix ? (
                <InlineEditable path={`${pathPrefix}/${idx}`} value={item} multiline />
              ) : (
                item
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function GeneratingPanel({ label }: { label: string }) {
  return (
    <div className="bg-white border border-slate-200 p-8 rounded-2xl shadow-xs flex items-center gap-4">
      <Loader2 className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" />
      <div>
        <p className="text-slate-900 font-semibold text-sm">{label} is being compiled…</p>
        <p className="text-xs text-slate-500 mt-0.5">The autonomous AI organization is actively writing this section.</p>
      </div>
    </div>
  )
}

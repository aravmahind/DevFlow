'use client'

import { useState } from 'react'
import { Loader2, Play, Pause, Square, CheckCircle2, AlertCircle, Bot, Sparkles } from 'lucide-react'
import { getProject, runProject, stopProject, pauseProject } from '@/lib/api'
import { useProjectStore } from '@/lib/project-store'
import { useProjectRole } from '@/components/auth/permission-guard'

const AGENT_LABELS: Record<string, string> = {
  ceo: 'CEO Supervisor',
  product_manager: 'Product Manager',
  architect: 'System Architect',
  sprint_planner: 'Sprint Planner',
  risk: 'Risk Auditor',
  team_allocation: 'Team Allocator',
  timeline: 'Timeline Agent',
  integration: 'Platform Integration',
}

/** Hook to determine if agents are actively working and identify which agent. */
export function useAgentWorkingState() {
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const progress = useProjectStore((s) => s.progress)
  const nodes = (project?.orchestration?.nodes || {}) as Record<string, { status?: string; label?: string; progress?: number }>

  const isWorking = status === 'running' || status === 'queued'
  const isPaused = status === 'paused'
  const isAwaitingApproval = status === 'awaiting_approval'
  const isStopped = status === 'stopped'
  const isComplete = status === 'complete'
  const isFailed = status === 'failed'
  const isIdle = !status || status === 'idle'

  // Identify currently active agent
  let activeAgentKey: string | null = project?.orchestration?.current_node || null
  if (!activeAgentKey) {
    for (const [k, v] of Object.entries(nodes)) {
      if (v?.status && v.status !== 'idle' && v.status !== 'complete' && v.status !== 'failed') {
        activeAgentKey = k
        break
      }
    }
  }

  const activeAgentName = activeAgentKey ? AGENT_LABELS[activeAgentKey] || activeAgentKey : null

  return {
    isWorking,
    isPaused,
    isAwaitingApproval,
    isStopped,
    isComplete,
    isFailed,
    isIdle,
    status,
    progress,
    activeAgentKey,
    activeAgentName,
  }
}

/** Badge component indicating if Agents are working, paused, or idle. */
export function AgentWorkingBadge({ compact = false }: { compact?: boolean }) {
  const {
    isWorking,
    isPaused,
    isAwaitingApproval,
    isStopped,
    isComplete,
    isFailed,
    progress,
    activeAgentName,
  } = useAgentWorkingState()

  if (isWorking) {
    return (
      <div
        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs"
        title="Agents are actively running and generating project assets"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="flex items-center gap-1">
          <Bot className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
          <span>Agents Working</span>
          {!compact && activeAgentName && (
            <span className="text-emerald-800 font-normal hidden lg:inline">
              : {activeAgentName}
            </span>
          )}
        </span>
        <span className="text-[11px] font-mono text-emerald-600/80 bg-emerald-100/60 px-1.5 py-0.2 rounded">
          {progress}%
        </span>
      </div>
    )
  }

  if (isPaused) {
    return (
      <div
        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-xs"
        title="Agents pipeline is paused. Click Start/Resume to continue."
      >
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span>Pipeline Paused</span>
        {!compact && <span className="text-amber-600/80 font-normal text-[11px] hidden sm:inline">(Saved)</span>}
      </div>
    )
  }

  if (isAwaitingApproval) {
    return (
      <div
        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-xs"
        title="Waiting for your approval before continuing next phase"
      >
        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
        <span>Waiting for Approval</span>
      </div>
    )
  }

  if (isStopped) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200"
        title="Agents pipeline stopped"
      >
        <span className="w-2 h-2 rounded-full bg-slate-400" />
        <span>Agents Stopped</span>
      </div>
    )
  }

  if (isComplete) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-900 text-white shadow-xs"
        title="All agents have completed delivery plan"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        <span>Agents Finished</span>
      </div>
    )
  }

  if (isFailed) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200"
        title="Pipeline run failed"
      >
        <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
        <span>Pipeline Failed</span>
      </div>
    )
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200"
      title="Agents are idle"
    >
      <span className="w-2 h-2 rounded-full bg-slate-300" />
      <span>Agents Idle</span>
    </div>
  )
}

/** Complete Start, Pause, and Stop control buttons for the agents pipeline. */
export function RunControls({ showBadge = false, compact = false }: { showBadge?: boolean; compact?: boolean }) {
  const project = useProjectStore((s) => s.project)
  const setProject = useProjectStore((s) => s.setProject)
  const role = useProjectRole()
  const { isWorking, isPaused, isComplete, status } = useAgentWorkingState()

  const [busy, setBusy] = useState<'run' | 'pause' | 'stop' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Allow managers and developers to control, or if role isn't loaded yet
  if (!project?.id) return null
  if (role && role === 'tester') return null

  const handleStart = async () => {
    setBusy('run')
    setError(null)
    try {
      await runProject(project.id)
      setProject(await getProject(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Start failed')
    } finally {
      setBusy(null)
    }
  }

  const handlePause = async () => {
    setBusy('pause')
    setError(null)
    try {
      await pauseProject(project.id)
      setProject(await getProject(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Pause failed')
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async () => {
    if (!confirm('Stop the agents pipeline? Generated sections will be preserved.')) return
    setBusy('stop')
    setError(null)
    try {
      await stopProject(project.id)
      setProject(await getProject(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Stop failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      {showBadge && <AgentWorkingBadge compact={compact} />}

      <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 shadow-xs">
        {/* Start / Resume Button */}
        <button
          onClick={handleStart}
          disabled={!!busy || isWorking}
          title={isPaused ? 'Resume pipeline' : isComplete ? 'Restart pipeline' : 'Start agents pipeline'}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            isWorking
              ? 'text-slate-400 hover:text-slate-400 cursor-not-allowed opacity-50'
              : isPaused
              ? 'bg-amber-600 text-white shadow-xs hover:bg-amber-700'
              : 'bg-blue-600 text-white shadow-xs hover:bg-blue-700'
          }`}
        >
          {busy === 'run' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
          <span>{isPaused ? 'Resume' : isComplete ? 'Restart' : 'Start'}</span>
        </button>

        {/* Pause Button */}
        <button
          onClick={handlePause}
          disabled={!!busy || !isWorking}
          title="Pause agents pipeline"
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            !isWorking
              ? 'text-slate-400 hover:text-slate-400 cursor-not-allowed opacity-50'
              : 'bg-white text-amber-700 hover:bg-amber-50 shadow-xs border border-amber-200'
          }`}
        >
          {busy === 'pause' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Pause className="w-3 h-3 fill-current" />
          )}
          <span>Pause</span>
        </button>

        {/* Stop Button */}
        <button
          onClick={handleStop}
          disabled={!!busy || (!isWorking && !isPaused)}
          title="Stop agents pipeline"
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            !isWorking && !isPaused
              ? 'text-slate-400 hover:text-slate-400 cursor-not-allowed opacity-50'
              : 'bg-white text-rose-700 hover:bg-rose-50 shadow-xs border border-rose-200'
          }`}
        >
          {busy === 'stop' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Square className="w-3 h-3 fill-current" />
          )}
          <span>Stop</span>
        </button>
      </div>

      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
    </div>
  )
}

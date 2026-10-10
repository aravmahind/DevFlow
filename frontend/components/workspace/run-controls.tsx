'use client'

import { useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'
import { getProject, runProject, stopProject } from '@/lib/api'
import { useProjectStore } from '@/lib/project-store'
import { useProjectRole } from '@/components/auth/permission-guard'

const ACTIVE = new Set(['queued', 'running'])
const RESUMABLE = new Set(['failed', 'stopped'])

/** Manager-only Run / Stop for the project's AI workflow. */
export function RunControls() {
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const setProject = useProjectStore((s) => s.setProject)
  const role = useProjectRole()
  const [busy, setBusy] = useState<'run' | 'stop' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (role !== 'manager' || !project?.id) return null
  const canStop = ACTIVE.has(status)
  const canRun = RESUMABLE.has(status)
  if (!canStop && !canRun) return null

  const act = async (kind: 'run' | 'stop') => {
    if (kind === 'stop' && !confirm('Stop this run? Sections already generated are kept, and Run continues from where it stopped.')) return
    setBusy(kind)
    setError(null)
    try {
      await (kind === 'run' ? runProject(project.id) : stopProject(project.id))
      setProject(await getProject(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Request failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {canStop ? (
        <button
          onClick={() => act('stop')}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-xs font-semibold transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy === 'stop' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3 fill-current" />}
          Stop
        </button>
      ) : (
        <button
          onClick={() => act('run')}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-600 hover:bg-blue-700 border border-blue-600 text-white text-xs font-semibold transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy === 'run' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
          {status === 'stopped' ? 'Resume' : 'Run'}
        </button>
      )}
      {error && <span className="text-[11px] text-rose-700">{error}</span>}
    </span>
  )
}

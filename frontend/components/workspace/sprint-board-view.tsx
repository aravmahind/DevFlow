'use client'

import { motion } from 'framer-motion'
import { LayoutGrid, Clock, Layers, Link2, Gauge, UserCircle2, ChevronDown, Check, Filter, Loader2, Wand2 } from 'lucide-react'
import { useProjectStore } from '@/lib/project-store'
import { useEffect, useRef, useState } from 'react'
import { autoAssignTasks, getProjectMembers, updateProjectTask } from '@/lib/api'
import { InlineEditable } from './workspace-editor'
import { useProjectRole } from '@/components/auth/permission-guard'
import { useAppUser } from '@/lib/auth-context'

const priorityPill: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const loadBarColor: Record<string, string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
}

const KANBAN_COLUMNS = ['To Do', 'In Progress', 'In Review', 'Done']

// ---------------------------------------------------------------------------
// Assignee picker dropdown (manager only)
// ---------------------------------------------------------------------------
function AssigneePicker({
  value, users, onChange
}: {
  value: string | null
  users: any[]
  onChange: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const assigned = users.find(u => u.user_id === value)
  const name = assigned ? `${assigned.first_name || ''} ${assigned.last_name || ''}`.trim() || assigned.email : null
  const avatarUrl = assigned?.image_url || (assigned ? `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'U')}&background=e2e8f0&color=475569&size=32` : null)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] font-medium rounded-lg px-2 py-1 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors max-w-[150px]"
      >
        {assigned ? (
          <>
            <img src={avatarUrl!} className="w-4 h-4 rounded-full border border-slate-300 object-cover flex-shrink-0" alt={name || ''} />
            <span className="truncate text-slate-700">{name}</span>
          </>
        ) : (
          <>
            <UserCircle2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="text-slate-400">Assign</span>
          </>
        )}
        <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0 ml-auto" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="p-1">
            <button
              onClick={() => { onChange(null); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <UserCircle2 className="w-5 h-5 text-slate-300" />
              <span>Unassigned</span>
              {!value && <Check className="w-3 h-3 text-blue-500 ml-auto" />}
            </button>
            {users.map((u, uIdx) => {
              const uName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email
              const uAvatar = u.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(uName)}&background=e2e8f0&color=475569&size=32`
              const isSelected = value === u.user_id
              return (
                <button
                  key={`${u.user_id || 'user'}-${uIdx}`}
                  onClick={() => { onChange(u.user_id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${
                    isSelected ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <img src={uAvatar} className="w-5 h-5 rounded-full border border-slate-200 object-cover flex-shrink-0" alt={uName} />
                  <div className="text-left min-w-0">
                    <p className="font-semibold truncate">{uName}</p>
                    {u.specialization && <p className="text-[10px] text-slate-400 truncate">{u.specialization}</p>}
                    {!u.specialization && u.role && <p className="text-[10px] text-slate-400 capitalize">{u.role}</p>}
                  </div>
                  {isSelected && <Check className="w-3 h-3 text-blue-500 flex-shrink-0 ml-auto" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Read-only assignee chip for non-managers
function AssigneeChip({ value, users }: { value: string | null; users: any[] }) {
  if (!value) return (
    <span className="flex items-center gap-1 text-[11px] text-slate-400">
      <UserCircle2 className="w-3.5 h-3.5" /> Unassigned
    </span>
  )
  const u = users.find(m => m.user_id === value)
  const name = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email : 'Member'
  const avatar = u?.image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e2e8f0&color=475569&size=32`
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 max-w-[150px]">
      <img src={avatar} className="w-4 h-4 rounded-full border border-slate-200 object-cover flex-shrink-0" alt={name} />
      <span className="truncate">{name}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function SprintBoardView() {
  const project = useProjectStore((s) => s.project)
  const setProject = useProjectStore((s) => s.setProject)
  const backlog = project?.backlog || null
  const { user } = useAppUser()

  const [viewMode, setViewMode] = useState<'sprint' | 'kanban'>('kanban')
  const [users, setUsers] = useState<any[]>([])
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const projectRole = useProjectRole()
  const [assigning, setAssigning] = useState(false)
  const [assignNote, setAssignNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [draggedTaskIndex, setDraggedTaskIndex] = useState<number | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  
  useEffect(() => {
    if (project?.id) getProjectMembers(project.id).then(res => { setUsers(res.members || []) }).catch(console.error)
  }, [project?.id])

  if (!backlog) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">Sprint Board</h2>
          <p className="text-slate-500 text-sm">Interactive agile board of every sprint and task</p>
        </div>
        <div className="bg-white border border-slate-200 p-12 rounded-2xl shadow-xs flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
            <LayoutGrid className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Sprint board is being generated by the AI organization.</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            The sprint planner is balancing capacity and distributing tasks.
          </p>
        </div>
      </div>
    )
  }

  const tasks = backlog.tasks || []
  const rawSprints = backlog.sprints || []
  const hasDuplicateNumbers = rawSprints.some((s: any, idx: number) =>
    rawSprints.slice(0, idx).some((prev: any) => prev.number === s.number)
  )
  const sprints = rawSprints
    .map((sprint: any, idx: number) => {
      const num = hasDuplicateNumbers || !sprint.number ? idx + 1 : sprint.number
      const name =
        sprint.name && sprint.name !== 'Sprint 1'
          ? sprint.name
          : hasDuplicateNumbers
          ? `Sprint ${idx + 1}`
          : sprint.name || `Sprint ${idx + 1}`
      return { ...sprint, number: num, name }
    })
    .sort((a: any, b: any) => a.number - b.number)

  // Ensure tasks have statuses
  const allNormalizedTasks = tasks.map((t: any, index: number) => ({ ...t, status: t.status || 'To Do', _index: index }))
  const normalizedTasks = myTasksOnly
    ? allNormalizedTasks.filter((t: any) => t.assignee_id === user?.id)
    : allNormalizedTasks

  const updateTask = async (taskIndex: number, updates: Partial<any>) => {
    if (!project) return
    const currentTask = tasks[taskIndex]
    if (!currentTask) return
    // Prevent redundant requests if already in that status
    if (updates.status && currentTask.status === updates.status) return

    setUpdateError(null)
    const newTasks = tasks.map((t: any, index: number) => index === taskIndex ? { ...t, ...updates } : t)
    const newBacklog = { ...backlog, tasks: newTasks }
    
    // Optimistic UI update
    setProject({ ...project, backlog: newBacklog })
    
    try {
      const result = await updateProjectTask(project.id, taskIndex, updates)
      if (result.project) setProject(result.project)
    } catch (err) {
      console.error("Failed to update task", err)
      setUpdateError(err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Failed to move task')
      // Rollback
      setProject({ ...project, backlog })
    }
  }

  const autoAssign = async () => {
    if (!project) return
    const overwrite = tasks.some((t: any) => t.assignee_id) &&
      confirm('Reassign tasks that already have an assignee too?\n\nOK = rebalance every open task · Cancel = only fill unassigned tasks')
    setAssigning(true)
    setAssignNote(null)
    try {
      const { project: updated, assignments } = await autoAssignTasks(project.id, overwrite)
      setProject(updated)
      const people = new Set(assignments.map((a) => a.assignee)).size
      setAssignNote({ ok: true, text: assignments.length
        ? `Assigned ${assignments.length} task${assignments.length === 1 ? '' : 's'} across ${people} member${people === 1 ? '' : 's'}.`
        : 'Every open task already has an assignee.' })
    } catch (err) {
      setAssignNote({ ok: false, text: err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : 'Auto-assign failed' })
    } finally {
      setAssigning(false)
    }
  }

  const handleDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    setDragOverCol(null)
    setDraggedTaskIndex(null)
    const raw = e.dataTransfer.getData('text/plain')
    if (raw === '' || raw === null || raw === undefined) return
    const taskIndex = Number(raw)
    if (Number.isInteger(taskIndex) && taskIndex >= 0 && taskIndex < tasks.length) {
      updateTask(taskIndex, { status })
    }
  }

  const renderTaskCard = (task: any, idx: number) => {
    const deps = task.dependencies?.length || 0
    const isAssignedToMe = task.assignee_id === user?.id
    const isBeingDragged = draggedTaskIndex === task._index
    return (
      <div
        key={`${task.title}-${task._index ?? idx}`}
        draggable
        onDragStart={(e: any) => {
          e.dataTransfer.setData('text/plain', String(task._index))
          e.dataTransfer.effectAllowed = 'move'
          setDraggedTaskIndex(task._index)
        }}
        onDragEnd={() => {
          setDraggedTaskIndex(null)
          setDragOverCol(null)
        }}
        className={`p-3.5 bg-white border rounded-xl hover:shadow-sm transition-all cursor-grab active:cursor-grabbing shadow-xs ${
          isBeingDragged ? 'opacity-40 scale-[0.98] border-blue-400 border-dashed bg-blue-50/20' : ''
        } ${
          isAssignedToMe ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-xs text-slate-900 leading-snug flex-1">
            <InlineEditable path={`/backlog/tasks/${task._index}/title`} value={task.title} />
          </p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 capitalize ${priorityPill[task.priority] || priorityPill.medium}`}>
            {task.priority || 'medium'}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {task.category && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
              {task.category}
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
            <Clock className="w-3 h-3 text-slate-400" /> {task.estimated_days}d
          </span>
          {deps > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
              <Link2 className="w-3 h-3 text-blue-500" /> {deps} {deps === 1 ? 'dep' : 'deps'}
            </span>
          )}
        </div>

        {/* Assignee row */}
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 gap-2">
          {projectRole === 'manager' ? (
            <AssigneePicker
              value={task.assignee_id || null}
              users={users}
              onChange={(id) => updateTask(task._index, { assignee_id: id })}
            />
          ) : (
            <AssigneeChip value={task.assignee_id || null} users={users} />
          )}
          {task.epic && (
            <p className="text-[10px] text-slate-500 flex items-center gap-1 max-w-[100px] truncate" title={task.epic}>
              <Layers className="w-3 h-3 flex-shrink-0 text-slate-400" /> {task.epic}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-0.5">Sprint Board</h2>
          <p className="text-slate-500 text-sm">
            {sprints.length} sprints · {normalizedTasks.length} tasks{myTasksOnly ? ' (my tasks)' : ''} · drag cards to update status
          </p>
          {assignNote && <p className={`text-xs mt-1 ${assignNote.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{assignNote.text}</p>}
          {updateError && (
            <div className="mt-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center justify-between gap-3 shadow-xs">
              <span>{updateError}</span>
              <button onClick={() => setUpdateError(null)} className="font-semibold text-rose-600 hover:text-rose-800 cursor-pointer">
                ✕
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {projectRole === 'manager' && (
            <button
              onClick={autoAssign}
              disabled={assigning}
              title="Assign unassigned tasks by skill match and workload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              Auto-assign
            </button>
          )}
          {/* My tasks filter */}
          <button
            onClick={() => setMyTasksOnly(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              myTasksOnly
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            My Tasks
          </button>
          {/* View toggle */}
          <div className="flex bg-slate-100 border border-slate-200 rounded-lg p-1">
            <button 
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              onClick={() => setViewMode('kanban')}
            >
              Kanban
            </button>
            <button 
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'sprint' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              onClick={() => setViewMode('sprint')}
            >
              Sprints
            </button>
          </div>
        </div>
      </div>

      <TeamLoad tasks={allNormalizedTasks} users={users} />

      {viewMode === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4 items-start min-h-[500px]">
          {KANBAN_COLUMNS.map((colName) => {
            const colTasks = normalizedTasks.filter((t: any) => t.status === colName)
            const isTargetCol = dragOverCol === colName
            return (
              <div
                key={colName}
                className={`border p-4 rounded-2xl flex-shrink-0 w-[290px] flex flex-col h-full min-h-[420px] transition-all ${
                  isTargetCol
                    ? 'bg-blue-50/80 border-blue-400 ring-2 ring-blue-400/30'
                    : 'bg-slate-100/70 border-slate-200'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverCol !== colName) setDragOverCol(colName)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (dragOverCol === colName) setDragOverCol(null)
                  }
                }}
                onDrop={(e) => handleDrop(e, colName)}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{colName}</h3>
                  <span className="text-xs font-semibold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                    {colTasks.length}
                  </span>
                </div>
                <div
                  className="space-y-3 flex-1 min-h-[140px]"
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => handleDrop(e, colName)}
                >
                  {colTasks.map((task: any, idx: number) => renderTaskCard(task, idx))}
                  {colTasks.length === 0 && (
                    <div
                      className={`border border-dashed rounded-xl p-5 text-center text-xs transition-colors ${
                        isTargetCol ? 'border-blue-400 text-blue-600 bg-blue-100/40 font-medium' : 'border-slate-300 text-slate-400'
                      }`}
                    >
                      Drop tasks here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 items-start">
          {sprints.map((sprint, sIdx) => {
            const colTasks = normalizedTasks.filter((t: any) => t.sprint === sprint.number)
            const colDays = colTasks.reduce((sum: number, t: any) => sum + (t.estimated_days || 0), 0)
            const maxSprintDays = Math.max(1, ...sprints.map(s => normalizedTasks.filter((t:any) => t.sprint === s.number).reduce((sum:number, t:any) => sum + (t.estimated_days || 0), 0)))
            const loadRatio = Math.min(1, colDays / maxSprintDays)
            const loadKey = loadRatio > 0.75 ? 'high' : loadRatio > 0.4 ? 'medium' : 'low'

            return (
              <div key={`sprint-${sprint.number ?? sIdx}-${sIdx}`} className="bg-slate-100/70 border border-slate-200 p-4 rounded-2xl flex-shrink-0 w-[290px] flex flex-col">
                <div className="mb-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Sprint {sprint.number}</span>
                    <span className="text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                      {colTasks.length} tasks
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 mt-1 leading-snug">{sprint.name}</h3>
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1 font-medium">
                      <span className="flex items-center gap-1">
                        <Gauge className="w-3 h-3 text-slate-400" /> Sprint Load
                      </span>
                      <span className="font-semibold text-slate-900">{Math.round(colDays)}d</span>
                    </div>
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full ${loadBarColor[loadKey]}`} style={{ width: `${Math.max(4, loadRatio * 100)}%` }} />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 flex-1">
                  {colTasks.map((task: any, idx: number) => renderTaskCard(task, idx))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team load: assigned estimated days per member (open tasks), plus unassigned.
// ---------------------------------------------------------------------------
function TeamLoad({ tasks, users }: { tasks: any[]; users: any[] }) {
  const open = tasks.filter((t) => !['done', 'complete', 'completed'].includes(String(t.status || '').toLowerCase()))
  const days = (t: any) => Number(t.estimated_days) || 0
  const people = users
    .filter((u) => u.role !== 'manager' || open.some((t) => t.assignee_id === u.user_id))
    .map((u) => {
      const mine = open.filter((t) => t.assignee_id === u.user_id)
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Member'
      return { id: u.user_id, name, spec: u.specialization || u.role, load: mine.reduce((a, t) => a + days(t), 0), count: mine.length }
    })
  const unassigned = open.filter((t) => !t.assignee_id)
  if (!people.length && !unassigned.length) return null
  const max = Math.max(1, ...people.map((p) => p.load))
  return (
    <section aria-label="Team load" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3 mb-5">
      {people.map((p, pIdx) => (
        <div key={`${p.id || 'person'}-${pIdx}`} className="bg-white border border-slate-200 rounded-lg px-3.5 py-3 flex items-center gap-3">
          <span className="w-7 h-7 rounded-full bg-slate-800 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
            {p.name.split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <span className="flex-1 min-w-0 space-y-1.5">
            <span className="flex justify-between gap-2 text-[13px]">
              <span className="font-semibold truncate">{p.name}{p.spec ? <span className="font-normal text-slate-500"> · {p.spec}</span> : null}</span>
              <span className="font-mono tabular-nums text-slate-600 shrink-0">{p.load}d</span>
            </span>
            <span className="block h-1 rounded-full bg-slate-100 overflow-hidden">
              <span className="block h-full bg-slate-950 rounded-full" style={{ width: `${(p.load / max) * 100}%` }} />
            </span>
          </span>
        </div>
      ))}
      {unassigned.length > 0 && (
        <div className="border border-dashed border-slate-300 rounded-lg px-3.5 py-3 flex items-center gap-3">
          <span className="w-7 h-7 rounded-full border-[1.5px] border-dashed border-slate-400 shrink-0" />
          <span className="flex-1 flex justify-between gap-2 text-[13px]">
            <span className="font-semibold">Unassigned</span>
            <span className="font-mono tabular-nums text-slate-600">{unassigned.length} tasks · {unassigned.reduce((a, t) => a + days(t), 0)}d</span>
          </span>
        </div>
      )}
    </section>
  )
}

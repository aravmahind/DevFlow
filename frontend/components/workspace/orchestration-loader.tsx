'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useProjectStore } from '@/lib/project-store'
import { retryProject, approveProject } from '@/lib/api'
import {
  Lightbulb,
  Search,
  Network,
  ListChecks,
  ShieldAlert,
  Users,
  CalendarRange,
  Plug,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  Terminal,
  ShieldCheck,
  Eye,
  Check,
  ChevronRight,
  RotateCw,
} from 'lucide-react'

interface AgentStage {
  id: string
  name: string
  role: string
  deliverableKey: string
  deliverableLabel: string
  nodeId: string
  icon: any
}

const ORCHESTRATION_STAGES: { title: string; description: string; agents: AgentStage[] }[] = [
  {
    title: 'Phase 1: Requirements Analysis',
    description: 'Executive vision, functional requirements, and user stories',
    agents: [
      {
        id: 'requirement_agent',
        name: 'Requirement Agent',
        role: 'Requirements Analyst & Product Strategist',
        deliverableKey: 'requirements',
        deliverableLabel: 'Vision & Requirements',
        nodeId: 'requirements',
        icon: Search,
      },
    ],
  },
  {
    title: 'Phase 2: System Architecture',
    description: 'Multi-layer system design, data entities, APIs, and infrastructure',
    agents: [
      {
        id: 'architect_agent',
        name: 'System Architect Agent',
        role: 'Principal Architect',
        deliverableKey: 'architecture',
        deliverableLabel: 'System Architecture & Data Models',
        nodeId: 'architecture',
        icon: Network,
      },
    ],
  },
  {
    title: 'Phase 3: Sprint Planning',
    description: 'Sprint backlog breakdown, team allocation, and timeline',
    agents: [
      {
        id: 'sprint_planner_agent',
        name: 'Sprint Planner Agent',
        role: 'Agile Delivery Lead',
        deliverableKey: 'backlog',
        deliverableLabel: 'Delivery Plan & Allocation',
        nodeId: 'sprint_planning',
        icon: ListChecks,
      },
    ],
  },
  {
    title: 'Phase 4: GitHub Monitoring (Parallel)',
    description: 'Analyzing repository progress and active development',
    agents: [
      {
        id: 'github_monitor',
        name: 'GitHub Monitor Agent',
        role: 'Development Progress Analyst',
        deliverableKey: 'github_progress',
        deliverableLabel: 'GitHub Progress Report',
        nodeId: 'execution',
        icon: Terminal,
      },
    ],
  },
  {
    title: 'Phase 5: Risk & Deployment (Parallel)',
    description: 'Risk matrix and infrastructure deployment strategies',
    agents: [
      {
        id: 'risk_agent',
        name: 'Risk Analyst Agent',
        role: 'Security & Risk Lead',
        deliverableKey: 'risks',
        deliverableLabel: 'Risk & Vulnerability Matrix',
        nodeId: 'risk',
        icon: ShieldAlert,
      },
      {
        id: 'deployment_advisor',
        name: 'Deployment Advisor',
        role: 'Infrastructure & Deployment Advisor',
        deliverableKey: 'deployment_recommendations',
        deliverableLabel: 'Infrastructure Recommendations',
        nodeId: 'deployment',
        icon: Plug,
      },
    ],
  },
]

const ALL_AGENTS = ORCHESTRATION_STAGES.flatMap((s) => s.agents)

export function OrchestrationLoader({ onDismiss }: { onDismiss?: () => void }) {
  const nodes = useProjectStore((s) => s.nodes)
  const logs = useProjectStore((s) => s.logs)
  const progress = useProjectStore((s) => s.progress)
  const project = useProjectStore((s) => s.project)
  const error = useProjectStore((s) => s.error)

  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)
  const logsEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleRetry = async () => {
    if (!project?.id || isRetrying) return
    setIsRetrying(true)
    try {
      await retryProject(project.id)
    } catch (e) {
      console.error('Retry failed:', e)
    } finally {
      setIsRetrying(false)
    }
  }

  // Count completed deliverables
  const completedCount = ALL_AGENTS.filter((a) => {
    const projectAny = project as any
    return !!projectAny?.[a.deliverableKey] || nodes[a.nodeId]?.status === 'complete'
  }).length

  // Find current active agent
  const activeAgent = ALL_AGENTS.find((a) => {
    const projectAny = project as any
    const isCompleted = !!projectAny?.[a.deliverableKey]
    const nodeStatus = nodes[a.nodeId]?.status
    return !isCompleted && (nodeStatus === 'thinking' || nodeStatus === 'analyzing' || nodeStatus === 'generating')
  }) || ALL_AGENTS.find((a) => {
    const projectAny = project as any
    return !projectAny?.[a.deliverableKey]
  })

  return (
    <div className="py-6 max-w-6xl mx-auto w-full space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                Orchestration in Progress
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-slate-600 text-xs font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                CEO Quality Supervision
              </span>
              {(error || completedCount < ALL_AGENTS.length) && (
                <button
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-medium transition-colors"
                >
                  <RotateCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                  <span>{isRetrying ? 'Retrying...' : 'Resume / Retry Incomplete'}</span>
                </button>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {project?.title || 'Compiling Project Specification & Delivery Plan'}
            </h1>
            <p className="text-slate-500 text-sm mt-1 max-w-2xl">
              Specialist agents are evaluating requirements, designing system architecture, and building delivery roadmaps.
            </p>
          </div>

          {/* Key Metrics */}
          <div className="flex items-center gap-5 bg-slate-50 border border-slate-200/80 rounded-lg px-4 py-3 self-start sm:self-auto">
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Progress</div>
              <div className="text-xl font-bold text-slate-900">{progress}%</div>
            </div>
            <div className="h-7 w-px bg-slate-200" />
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" /> Elapsed
              </div>
              <div className="text-xs font-semibold text-slate-800 mt-0.5 font-mono">
                {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
              </div>
            </div>
            <div className="h-7 w-px bg-slate-200" />
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Completed</div>
              <div className="text-xs font-semibold text-slate-800 mt-0.5">
                {completedCount} / {ALL_AGENTS.length}
              </div>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-2">
            <span>Pipeline Status</span>
            <span>{completedCount === ALL_AGENTS.length ? 'Finalizing Quality Review' : `${completedCount} of ${ALL_AGENTS.length} Deliverables Generated`}</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
            <motion.div
              className="h-full bg-blue-600 rounded-full"
              initial={{ width: '5%' }}
              animate={{ width: `${Math.max(5, progress)}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      {project?.status === 'awaiting_approval' && project?.pending_approval && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <ShieldAlert className="w-6 h-6 text-amber-600" />
            <h2 className="text-lg font-bold text-amber-900">Manager Approval Required</h2>
          </div>
          <p className="text-amber-800 text-sm mb-6">
            The workflow has paused at phase: <strong>{project.pending_approval}</strong>. Please review the generated artifacts and either approve to continue, or provide feedback to revise them.
          </p>
          <div className="flex flex-col gap-3">
            <textarea
              id="feedback-input"
              className="w-full border border-amber-300 rounded-md p-3 text-sm focus:ring-amber-500 focus:border-amber-500 bg-white"
              rows={3}
              placeholder="Optional: Provide feedback for revision if rejecting..."
            />
            <div className="flex gap-3 mt-2">
              <button
                className="px-4 py-2 bg-emerald-600 text-white rounded-md text-sm font-semibold hover:bg-emerald-700"
                onClick={async () => {
                  const fb = (document.getElementById('feedback-input') as HTMLTextAreaElement).value
                  try {
                    await approveProject(project.id, project.pending_approval, true, fb)
                    // UI will auto-update via polling / WebSocket
                  } catch (err) {
                    console.error('Failed to approve:', err)
                    alert('Failed to approve project.')
                  }
                }}
              >
                Approve & Continue
              </button>
              <button
                className="px-4 py-2 bg-white text-rose-600 border border-rose-300 rounded-md text-sm font-semibold hover:bg-rose-50"
                onClick={async () => {
                  const fb = (document.getElementById('feedback-input') as HTMLTextAreaElement).value
                  if (!fb) { alert('Please provide feedback for revision'); return; }
                  try {
                    await approveProject(project.id, project.pending_approval, false, fb)
                    // UI will auto-update via polling / WebSocket
                  } catch (err) {
                    console.error('Failed to reject:', err)
                    alert('Failed to reject project.')
                  }
                }}
              >
                Reject & Revise
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid: Orchestration Phases + Real-time Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
        {/* Left Column (7 cols): Execution Phases */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 mb-4">
              <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                Orchestration Stages & Agents
              </h2>
              <span className="text-xs text-slate-400 font-medium">8 Specialist Roles</span>
            </div>

            <div className="space-y-4">
              {ORCHESTRATION_STAGES.map((stage, stageIdx) => {
                const isStageComplete = stage.agents.every((a) => {
                  const projectAny = project as any
                  return !!projectAny?.[a.deliverableKey] || nodes[a.nodeId]?.status === 'complete'
                })
                const isStageActive = stage.agents.some((a) => {
                  const projectAny = project as any
                  const isDone = !!projectAny?.[a.deliverableKey]
                  const st = nodes[a.nodeId]?.status
                  return !isDone && (st === 'thinking' || st === 'analyzing' || st === 'generating' || activeAgent?.id === a.id)
                })

                return (
                  <div
                    key={stage.title}
                    className={`rounded-lg border p-3.5 transition-colors ${
                      isStageActive
                        ? 'bg-blue-50/30 border-blue-200'
                        : isStageComplete
                        ? 'bg-slate-50/60 border-slate-200'
                        : 'bg-white border-slate-200/60 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                          isStageComplete
                            ? 'bg-emerald-100 text-emerald-700'
                            : isStageActive
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-400'
                        }`}>
                          {isStageComplete ? <Check className="w-3 h-3" /> : stageIdx + 1}
                        </div>
                        <span className="text-xs font-bold text-slate-800">{stage.title}</span>
                      </div>
                      {isStageComplete && (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          Complete
                        </span>
                      )}
                      {isStageActive && (
                        <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> In Progress
                        </span>
                      )}
                    </div>

                    {/* Agent Cards within this stage */}
                    <div className="space-y-1.5 mt-2.5 pl-7">
                      {stage.agents.map((agent) => {
                        const projectAny = project as any
                        const isAgentDone = !!projectAny?.[agent.deliverableKey] || nodes[agent.nodeId]?.status === 'complete'
                        const isAgentActive = !isAgentDone && (nodes[agent.nodeId]?.status === 'thinking' || activeAgent?.id === agent.id)

                        return (
                          <div
                            key={agent.id}
                            className={`flex items-center justify-between py-1.5 px-2.5 rounded text-xs border ${
                              isAgentActive
                                ? 'bg-white border-blue-300 font-medium text-blue-900 shadow-xs'
                                : isAgentDone
                                ? 'bg-white/80 border-slate-200/80 text-slate-700'
                                : 'bg-slate-50/50 border-slate-200/50 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <agent.icon className={`w-3.5 h-3.5 ${isAgentDone ? 'text-emerald-600' : isAgentActive ? 'text-blue-600' : 'text-slate-400'}`} />
                              <span className="font-semibold">{agent.name}</span>
                              <span className="text-slate-400 text-[11px]">({agent.role})</span>
                            </div>
                            <div className="text-[11px] font-mono">
                              {isAgentDone ? (
                                <span className="text-emerald-600 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" /> Ready
                                </span>
                              ) : isAgentActive ? (
                                <span className="text-blue-600 flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Processing
                                </span>
                              ) : (
                                <span className="text-slate-400">Pending</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {onDismiss && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">Orchestration continues in background</span>
              <button
                onClick={onDismiss}
                className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1 hover:underline"
              >
                <span>View workspace preview</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Right Column (5 cols): Activity Audit Log */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col h-[620px]">
          <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Live Execution Feed
              </h2>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              {logs.length} entries
            </span>
          </div>

          {/* Log Stream */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-[11px]">
            {logs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-300 mb-2" />
                <p className="text-xs">Initializing orchestration pipeline...</p>
              </div>
            ) : (
              logs.map((log, i) => {
                const isError = log.level === 'error'
                const isWarning = log.level === 'warning'
                const isSuccess = log.message.includes('complete') || log.message.includes('✓') || log.message.includes('Passed')

                return (
                  <div
                    key={i}
                    className={`p-2 rounded border leading-relaxed ${
                      isError
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : isWarning
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : isSuccess
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                      <span className="font-semibold uppercase text-slate-600">
                        {log.agent ? `${log.agent}` : 'System'}
                      </span>
                      <span>
                        {log.ts ? new Date(log.ts).toLocaleTimeString() : new Date().toLocaleTimeString()}
                      </span>
                    </div>
                    <div>{log.message}</div>
                  </div>
                )
              })
            )}
            <div ref={logsEndRef} />
          </div>

          {error && (
            <div className="mt-3 p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-750 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
                <span className="line-clamp-2 text-rose-800">{error}</span>
              </div>
              <button
                onClick={handleRetry}
                disabled={isRetrying}
                className="flex-shrink-0 px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-medium text-[11px] transition-colors flex items-center gap-1"
              >
                <RotateCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                <span>Retry</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

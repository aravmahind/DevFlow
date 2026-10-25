'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useProjectStore } from '@/lib/project-store'
import { retryProject, approveProject, getProject } from '@/lib/api'
import { RunControls } from './run-controls'
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
  Square,
  Pause,
  Bot,
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

const APPROVAL_INFO: Record<string, { title: string; subtitle: string }> = {
  requirements: {
    title: 'Requirements Analysis',
    subtitle: 'The Requirements Agent has drafted product scope, user stories, and acceptance criteria.',
  },
  architecture: {
    title: 'System Architecture',
    subtitle: 'The System Architect has designed the component hierarchy, data models, and API specs.',
  },
  sprint_planning: {
    title: 'Sprint Planning',
    subtitle: 'The Sprint Planner has organized the delivery milestones, backlog tasks, and estimates.',
  },
  sprint_review: {
    title: 'Sprint Review & Quality Audit',
    subtitle: 'Execution monitoring, risk auditing, and deployment strategies have been prepared.',
  },
}

export function OrchestrationLoader({ onDismiss }: { onDismiss?: () => void }) {
  const nodes = useProjectStore((s) => s.nodes)
  const logs = useProjectStore((s) => s.logs)
  const progress = useProjectStore((s) => s.progress)
  const project = useProjectStore((s) => s.project)
  const error = useProjectStore((s) => s.error)
  const status = useProjectStore((s) => s.status)
  const setProject = useProjectStore((s) => s.setProject)

  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [isApproving, setIsApproving] = useState(false)
  const logsEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const effectiveLogs = useMemo(() => {
    if (logs && logs.length > 0) return logs

    // Reconstruct audit trail from completed deliverables & node states
    const synthesized = [
      {
        agent: 'orchestrator',
        level: 'info',
        message: `Pipeline initialized for "${project?.title || 'Project'}". Ready to orchestrate.`,
        ts: project?.created_at ? new Date(project.created_at).getTime() : Date.now(),
      },
    ]

    const projectAny = project as any
    for (const stage of ORCHESTRATION_STAGES) {
      for (const agent of stage.agents) {
        const hasDeliverable = !!projectAny?.[agent.deliverableKey]
        const nodeState = nodes[agent.nodeId]?.status

        if (hasDeliverable || nodeState === 'complete') {
          synthesized.push({
            agent: agent.name.toLowerCase().replace(/\s+agent$/i, ''),
            level: 'info',
            message: `✓ Completed deliverable: ${agent.deliverableLabel}`,
            ts: Date.now(),
          })
        } else if (nodeState === 'thinking' || nodeState === 'analyzing' || nodeState === 'generating') {
          synthesized.push({
            agent: agent.name.toLowerCase().replace(/\s+agent$/i, ''),
            level: 'info',
            message: `Currently active: ${agent.role}...`,
            ts: Date.now(),
          })
        }
      }
    }

    if (status === 'complete') {
      synthesized.push({
        agent: 'orchestrator',
        level: 'info',
        message: '✓ All phase deliverables generated and verified successfully.',
        ts: Date.now(),
      })
    } else if (status === 'stopped') {
      synthesized.push({
        agent: 'orchestrator',
        level: 'warning',
        message: 'Pipeline execution was stopped.',
        ts: Date.now(),
      })
    }

    return synthesized
  }, [logs, project, nodes, status])

  // Keep the log panel pinned to its newest line without scrolling the page.
  useEffect(() => {
    const panel = logsEndRef.current?.parentElement
    if (panel) panel.scrollTop = panel.scrollHeight
  }, [effectiveLogs.length])

  const handleRetry = async () => {
    if (!project?.id || isRetrying) return
    setIsRetrying(true)
    setRetryError(null)
    try {
      await retryProject(project.id)
      setProject(await getProject(project.id))
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : 'Retry failed')
    } finally {
      setIsRetrying(false)
    }
  }

  const failed = status === 'failed'
  // A queued run with an error is waiting out a backoff before retrying itself.
  const autoRetrying = status === 'queued' && !!error

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
              {status === 'complete' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Agents Finished
                </span>
              ) : status === 'stopped' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold">
                  <Square className="w-3 h-3 fill-current text-slate-500" />
                  Stopped
                </span>
              ) : failed ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                  Run Failed
                </span>
              ) : autoRetrying ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
                  <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                  Retrying Automatically
                </span>
              ) : status === 'awaiting_approval' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                  Waiting for Approval
                </span>
              ) : status === 'paused' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
                  <Pause className="w-3.5 h-3.5 text-amber-600" />
                  Pipeline Paused
                </span>
              ) : status === 'idle' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold">
                  <Bot className="w-3.5 h-3.5 text-slate-500" />
                  Agents Idle
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  Orchestration in Progress
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-slate-600 text-xs font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                CEO Quality Supervision
              </span>
              <RunControls />
              {(failed || (status === 'complete' && completedCount < ALL_AGENTS.length)) && (
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
              {status === 'complete'
                ? 'All specialist agents have completed delivery plan specifications, system architecture, and risk analysis.'
                : 'Specialist agents are evaluating requirements, designing system architecture, and building delivery roadmaps.'}
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
            <span>{status === 'complete' ? 'All Deliverables Generated & Verified' : completedCount === ALL_AGENTS.length ? 'Finalizing Quality Review' : `${completedCount} of ${ALL_AGENTS.length} Deliverables Generated`}</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
            <motion.div
              className="h-full bg-slate-950 rounded-full"
              initial={{ width: '5%' }}
              animate={{ width: `${Math.max(5, progress)}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      <AgentConstellation />

      {project?.status === 'awaiting_approval' && project?.pending_approval && (() => {
        const info = APPROVAL_INFO[project.pending_approval] || {
          title: project.pending_approval.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          subtitle: 'The autonomous agents have paused for human review before proceeding.',
        }
        return (
          <div className="liquid-glass-dark rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-signal signal-pulse" />
              <h2 className="text-lg font-semibold tracking-tight">Your approval is needed</h2>
            </div>
            <p className="text-xs uppercase tracking-wider text-signal font-mono font-medium mb-1">
              Phase Review: {info.title}
            </p>
            <p className="text-neutral-300 text-sm mb-1">
              {info.subtitle}
            </p>
            <p className="text-neutral-400 text-xs mb-5">
              Approve to continue to the next phase, or provide feedback and send it back for a revision.
            </p>
            <div className="flex flex-col gap-3">
              <textarea
                id="feedback-input"
                className="w-full rounded-lg p-3 text-sm bg-white/5 border border-white/15 text-white placeholder:text-neutral-500 focus:outline-none focus:border-signal"
                rows={3}
                placeholder="Optional: Provide feedback for revision if requesting changes..."
              />
              <div className="flex gap-3 mt-2">
                <button
                  className="inline-flex items-center gap-2 px-5 min-h-11 bg-signal text-slate-950 rounded-full text-sm font-semibold disabled:opacity-60 cursor-pointer hover:brightness-105 transition-all"
                  disabled={isApproving}
                  onClick={async () => {
                    if (isApproving) return
                    const fb = (document.getElementById('feedback-input') as HTMLTextAreaElement).value
                    setIsApproving(true)
                    try {
                      await approveProject(project.id, project.pending_approval!, true, fb)
                      setProject(await getProject(project.id))
                    } catch (err) {
                      console.error('Failed to approve:', err)
                      alert('Failed to approve project.')
                    } finally {
                      setIsApproving(false)
                    }
                  }}
                >
                  {isApproving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Approve & continue
                </button>
                <button
                  className="inline-flex items-center gap-2 px-5 min-h-11 text-white border border-white/20 rounded-full text-sm font-semibold hover:bg-white/10 disabled:opacity-60 cursor-pointer transition-colors"
                  disabled={isApproving}
                  onClick={async () => {
                    if (isApproving) return
                    const fb = (document.getElementById('feedback-input') as HTMLTextAreaElement).value
                    if (!fb) { alert('Please provide feedback for revision'); return; }
                    setIsApproving(true)
                    try {
                      await approveProject(project.id, project.pending_approval!, false, fb)
                      setProject(await getProject(project.id))
                    } catch (err) {
                      console.error('Failed to reject:', err)
                      alert('Failed to reject project.')
                    } finally {
                      setIsApproving(false)
                    }
                  }}
                >
                  {isApproving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send back with feedback
                </button>
              </div>
            </div>
          </div>
        )
      })()}

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
              {effectiveLogs.length} entries
            </span>
          </div>

          {/* Log Stream */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-[11px]">
            {effectiveLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-4">
                {status === 'running' || status === 'queued' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-blue-500 mb-2" />
                    <p className="text-xs font-medium text-slate-600">Connecting to agent stream...</p>
                    <p className="text-[10px] text-slate-400 mt-1">Listening for live execution events</p>
                  </>
                ) : (
                  <>
                    <Terminal className="w-5 h-5 text-slate-300 mb-2" />
                    <p className="text-xs font-medium text-slate-600">Pipeline ready</p>
                    <p className="text-[10px] text-slate-400 mt-1">Start the pipeline to begin live orchestration</p>
                  </>
                )}
              </div>
            ) : (
              effectiveLogs.map((log, i) => {
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

          {error && autoRetrying && (
            <div className="mt-3 p-2.5 rounded bg-amber-50 border border-amber-200 text-xs flex items-center gap-2">
              <RotateCw className="w-4 h-4 flex-shrink-0 text-amber-600" />
              <span className="line-clamp-2 text-amber-800">{error}</span>
            </div>
          )}

          {retryError && (
            <div className="mt-3 p-2.5 rounded bg-rose-50 border border-rose-200 text-xs text-rose-800">
              Could not restart the run: {retryError}
            </div>
          )}

          {error && failed && (
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

// ---------------------------------------------------------------------------
// Agent constellation: the AI org as a live graph. Done agents get a check,
// the active one pulses in signal lime, queued ones are dashed.
// ---------------------------------------------------------------------------
const CONSTELLATION_POS = [
  { left: 9, top: 50 }, { left: 25, top: 27 }, { left: 42, top: 50 },
  { left: 59, top: 27 }, { left: 75, top: 50 }, { left: 90.5, top: 27 }, { left: 90.5, top: 75 },
]

type NodeState = 'done' | 'active' | 'waiting' | 'queued' | 'failed'

function AgentConstellation() {
  const nodes = useProjectStore((s) => s.nodes)
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)
  const projectAny = project as any

  const states: NodeState[] = ALL_AGENTS.map((a) => {
    const st = nodes[a.nodeId]?.status
    if (st === 'failed') return 'failed'
    const isWaiting = status === 'awaiting_approval' && (
      project?.pending_approval === a.nodeId ||
      (project?.pending_approval === 'sprint_review' && (a.nodeId === 'execution' || a.nodeId === 'deployment'))
    )
    if (isWaiting) return 'waiting'
    if (st === 'complete' || projectAny?.[a.deliverableKey]) return 'done'
    if (st === 'thinking' || st === 'analyzing' || st === 'generating') return 'active'
    return 'queued'
  })
  // While running with nothing flagged active yet, the first unfinished agent is the one working.
  if ((status === 'running' || status === 'queued') && !states.includes('active')) {
    const next = states.findIndex((st) => st === 'queued')
    if (next >= 0) states[next] = 'active'
  }
  const active = ALL_AGENTS[states.indexOf('active')]
  const labels = ['Idea', ...ALL_AGENTS.map((a) => a.name.replace(/ Agent$/, '').replace(/^System /, ''))]
  labels.length = Math.min(labels.length, CONSTELLATION_POS.length)
  const pos = CONSTELLATION_POS.slice(0, labels.length)
  const nodeState = (i: number): NodeState => (i === 0 ? 'done' : states[i - 1])
  const edges = pos.slice(1).map((p, i) => {
    // The last two agents both branch from the one before them.
    const from = i >= 5 ? pos[4] : pos[i]
    return { from, to: p, state: nodeState(i + 1) }
  })

  return (
    <section aria-label="Agent organization" className="liquid-glass-dark rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className={`w-2 h-2 rounded-full ${active ? 'bg-signal signal-pulse' : 'bg-neutral-500'}`} />
          {active ? `${active.name} is working` : status === 'awaiting_approval' ? 'Paused for your approval' : status === 'complete' ? 'All agents finished' : 'Agents idle'}
        </span>
        <span className="font-mono text-xs text-neutral-400 tabular-nums">
          {states.filter((st) => st === 'done').length} of {ALL_AGENTS.length} agents done
        </span>
      </div>
      <div className="relative h-[260px] rounded-xl border border-white/10 bg-black/40 overflow-hidden">
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0">
          {edges.map((e, i) => (
            <line
              key={i}
              x1={e.from.left} y1={e.from.top} x2={e.to.left} y2={e.to.top}
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
              stroke={e.state === 'active' ? '#c8f26b' : e.state === 'done' || e.state === 'waiting' ? '#737373' : '#262626'}
              className={e.state === 'active' ? 'signal-flow' : undefined}
            />
          ))}
        </svg>
        {labels.map((label, i) => {
          const st = nodeState(i)
          return (
            <div
              key={label + i}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-[13px] whitespace-nowrap flex items-center gap-2 ${
                st === 'active' ? 'bg-neutral-900 border-[1.5px] border-signal font-semibold signal-pulse'
                : st === 'done' ? 'bg-neutral-900 border border-neutral-600 font-medium'
                : st === 'waiting' ? 'bg-neutral-900 border border-signal/60 font-medium'
                : st === 'failed' ? 'bg-neutral-900 border border-rose-400 text-rose-200'
                : 'border border-dashed border-neutral-700 text-neutral-500'
              }`}
              style={{ left: `${pos[i].left}%`, top: `${pos[i].top}%` }}
            >
              {st === 'done' && i > 0 && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
              {st === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-signal" />}
              {st === 'waiting' && <ShieldAlert className="w-3.5 h-3.5 text-signal" />}
              {label}
            </div>
          )
        })}
      </div>
    </section>
  )
}

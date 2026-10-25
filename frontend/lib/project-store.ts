import { create } from 'zustand'
import type {
  LogEntry,
  OrchestrationEvent,
  OrchestrationNodeState,
  ProjectDoc,
} from './project-types'

const NODE_IDS = ['idea', 'requirements', 'architecture', 'tasks', 'sprint', 'risk', 'cost', 'execution']
const NODE_LABELS: Record<string, string> = {
  idea: 'Idea Intake',
  requirements: 'Requirements',
  architecture: 'Architecture',
  tasks: 'Task Generation',
  sprint: 'Sprint Plan',
  risk: 'Risk Analysis',
  cost: 'Cost Estimate',
  execution: 'Execution Plan',
}

const SECTION_KEYS = [
  'manager_inputs',
  'executive_summary',
  'requirements',
  'architecture',
  'backlog',
  'risks',
  'team',
  'cost',
  'timeline',
  'integrations',
] as const

function initialNodes(): Record<string, OrchestrationNodeState> {
  return Object.fromEntries(
    NODE_IDS.map((id) => [id, { status: 'idle' as const, progress: 0, label: NODE_LABELS[id] }]),
  )
}

interface ProjectStore {
  projectId: string | null
  status: string
  progress: number
  error: string | null
  nodes: Record<string, OrchestrationNodeState>
  logs: LogEntry[]
  project: ProjectDoc | null
  lastSeq: number

  setProjectId: (id: string | null) => void
  reset: () => void
  applyEvent: (evt: OrchestrationEvent) => void
  setProject: (doc: ProjectDoc) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projectId: null,
  status: 'idle',
  progress: 0,
  error: null,
  nodes: initialNodes(),
  logs: [],
  project: null,
  lastSeq: 0,

  setProjectId: (id) => set({ projectId: id }),

  reset: () =>
    set({
      status: 'idle',
      progress: 0,
      error: null,
      nodes: initialNodes(),
      logs: [],
      project: null,
      lastSeq: 0,
    }),

  setProject: (doc) =>
    set({
      project: doc,
      status: doc.status,
      progress: doc.progress ?? get().progress,
      error: doc.error ?? null,
      nodes: { ...initialNodes(), ...(doc.orchestration?.nodes || {}) },
      logs: doc.orchestration?.logs || get().logs,
    }),

  applyEvent: (evt) => {
    const state = get()
    switch (evt.type) {
      case 'snapshot': {
        get().setProject(evt.project)
        break
      }
      case 'node_update': {
        set({
          nodes: {
            ...state.nodes,
            [evt.node]: {
              status: evt.status,
              progress: evt.progress,
              label: evt.label || state.nodes[evt.node]?.label || evt.node,
            },
          },
          lastSeq: evt.seq,
        })
        break
      }
      case 'log': {
        const next = [...state.logs, { agent: evt.agent, level: evt.level, message: evt.message, ts: evt.ts }]
        set({ logs: next.slice(-300), lastSeq: evt.seq })
        break
      }
      case 'section_complete': {
        const project = (state.project ? { ...state.project } : ({} as ProjectDoc)) as any
        project[evt.section] = evt.data
        set({ project, lastSeq: evt.seq })
        break
      }
      case 'progress': {
        set({ progress: evt.progress, lastSeq: evt.seq })
        break
      }
      case 'run_complete': {
        const nextProject = state.project ? { ...state.project, status: 'complete' as const, progress: 100, pending_approval: null } : state.project
        set({ status: 'complete', progress: 100, project: nextProject, lastSeq: evt.seq })
        break
      }
      case 'paused_for_approval': {
        const nextProject = state.project
          ? {
              ...state.project,
              status: 'awaiting_approval' as const,
              pending_approval: evt.pending_approval || state.project.pending_approval,
            }
          : state.project
        set({
          status: 'awaiting_approval',
          project: nextProject,
          lastSeq: evt.seq ?? state.lastSeq,
        })
        break
      }
      case 'run_failed': {
        set({status:'failed',error:`${evt.message}: ${evt.missing_sections.join(', ')}`,lastSeq:evt.seq})
        break
      }
      case 'error': {
        const next = [
          ...state.logs,
          { agent: evt.agent, level: 'error', message: evt.message },
        ]
        set({ logs: next.slice(-300), error: evt.message })
        break
      }
      case 'supervisor_review': {
        const next = [
          ...state.logs,
          {
            agent: 'ceo',
            level: evt.passed ? 'info' : 'warning',
            message: `[CEO Supervision R${evt.round}] ${evt.passed ? 'Passed ✓' : `Re-evaluating (${evt.directives_count} directives)`} — ${evt.assessment}`,
            ts: Date.now(),
          },
        ]
        set({ logs: next.slice(-300), lastSeq: evt.seq ?? state.lastSeq })
        break
      }
      case 'supervisor_directive': {
        const next = [
          ...state.logs,
          {
            agent: 'ceo',
            level: 'warning',
            message: `[CEO Directive R${evt.round} -> ${evt.agent}] ${evt.reason}`,
            ts: Date.now(),
          },
        ]
        set({ logs: next.slice(-300), lastSeq: evt.seq ?? state.lastSeq })
        break
      }
      case 'quality_score': {
        const next = [
          ...state.logs,
          {
            agent: evt.agent,
            level: evt.passed ? 'info' : 'warning',
            message: `[Quality Gate] ${evt.passed ? 'Passed ✓' : `Issues: ${evt.issues.join(', ')}`}`,
            ts: Date.now(),
          },
        ]
        set({ logs: next.slice(-300), lastSeq: evt.seq ?? state.lastSeq })
        break
      }
      case 'ping':
      case 'stream_end':
      case 'run_started':
      default:
        break
    }
  },
}))

export { NODE_IDS, NODE_LABELS, SECTION_KEYS }

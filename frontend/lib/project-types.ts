// Types mirroring the backend project document. Fields are optional because a
// document is filled in progressively as agents complete.

export type NodeStatus = 'idle' | 'thinking' | 'analyzing' | 'generating' | 'complete' | 'failed'

export interface OrchestrationNodeState {
  status: NodeStatus
  progress: number
  label: string
}

export interface LogEntry {
  agent?: string
  level?: string
  message: string
  ts?: number
}

export interface ExecutiveSummary {
  project_title: string
  tagline: string
  vision: string
  overview: string
  business_goals: string[]
  success_criteria: string[]
  target_users: string[]
  key_differentiators: string[]
  complexity_score: number
  complexity_label: string
  estimated_duration_weeks: number
  recommended_team_size: number
  competitive_landscape?: string
  go_to_market?: string
}

export interface RequirementItem {
  title: string
  category: string
  description: string
  priority: 'high' | 'medium' | 'low'
}

export interface UserStory {
  as_a: string
  i_want: string
  so_that: string
  acceptance_criteria: string[]
  priority: 'high' | 'medium' | 'low'
}

export interface RequirementsBundle {
  functional_requirements: RequirementItem[]
  non_functional_requirements: RequirementItem[]
  user_stories: UserStory[]
  scope_in: string[]
  scope_out: string[]
}

export interface ArchitectureLayer {
  summary: string
  components: string[]
  technologies: string[]
  decisions: string[]
}

export interface DiagramNode {
  id: string
  label: string
  group: string
  kind: string
}
export interface DiagramEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface ArchitectureBundle {
  frontend: ArchitectureLayer
  backend: ArchitectureLayer
  database: ArchitectureLayer
  infrastructure: ArchitectureLayer
  technology_recommendations: string[]
  scalability_plan: string[]
  integration_points: string[]
  data_flows?: { source: string; target: string; label: string }[]
  architecture_rationale?: string
  diagram?: { nodes: DiagramNode[]; edges: DiagramEdge[] }
  mermaid?: string
}

export interface TaskItem {
  title: string
  description: string
  category: string
  epic: string
  estimated_days: number
  priority: 'high' | 'medium' | 'low'
  sprint: number
  dependencies: string[]
  status?: string
  assignee_id?: string | null
}
export interface Epic {
  title: string
  description: string
}
export interface Sprint {
  number: number
  name: string
  goal: string
  task_titles: string[]
}
export interface SprintPlan {
  methodology: string
  sprint_length_weeks: number
  epics: Epic[]
  tasks: TaskItem[]
  sprints: Sprint[]
}

export interface RiskItem {
  title: string
  description: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  probability: number
  impact: number
  mitigation: string
}
export interface RiskBundle {
  risks: RiskItem[]
  overall_risk_level: string
  summary: string
}

export interface TeamMember {
  role: string
  seniority: string
  count: number
  skills: string[]
  responsibilities: string[]
  allocation_pct: number
}
export interface TeamPlan {
  members: TeamMember[]
  staffing_notes: string[]
  ownership: string[]
}

export interface CostLine {
  category: string
  monthly_usd: number
  notes: string
}
export interface CostPlan {
  lines: CostLine[]
  monthly_total_usd: number
  project_total_usd: number
  duration_months: number
  currency: string
}

export interface MilestoneItem {
  title: string
  description: string
  phase: 'mvp' | 'beta' | 'production' | 'scaling'
  start_week: number
  duration_weeks: number
  deliverables: string[]
  dependencies: string[]
}
export interface TimelinePlan {
  milestones: MilestoneItem[]
  total_duration_weeks: number
  critical_path: string[]
}

export interface IntegrationItem {
  name: string
  category: string
  purpose: string
  steps: string[]
}
export interface IntegrationBundle {
  integrations: IntegrationItem[]
  deployment_plan: string[]
  cicd_recommendations: string[]
}

export interface ProjectDoc {
  id: string
  title: string
  idea: string
  status: 'queued' | 'running' | 'awaiting_approval' | 'complete' | 'failed' | 'stopped' | 'paused' | 'idle'
  progress: number
  error: string | null
  created_at: string
  updated_at: string
  revision?: number
  pending_approval?: string | null
  workspace_id?: string
  manager_inputs?: {
    team_size?: number
    timeline_weeks?: number | null
    budget_usd?: number | null
    methodology?: string
    team_skills?: string[]
    priorities?: string[]
    constraints?: string
  }
  orchestration: {
    current_node: string | null
    nodes: Record<string, OrchestrationNodeState>
    logs: LogEntry[]
  }
  executive_summary: ExecutiveSummary | null
  requirements: RequirementsBundle | null
  architecture: ArchitectureBundle | null
  backlog: SprintPlan | null
  risks: RiskBundle | null
  team: TeamPlan | null
  cost: CostPlan | null
  timeline: TimelinePlan | null
  integrations: IntegrationBundle | null
  insights?: {
    health_rationale?: string
    assumptions?: string[]
    dependencies?: string[]
    recommendations?: string[]
  } | null
}

export type OrchestrationEvent =
  | { type: 'snapshot'; project: ProjectDoc }
  | { type: 'run_started'; agents: { id: string; name: string; role: string; node: string }[]; seq: number }
  | { type: 'node_update'; node: string; status: NodeStatus; progress: number; label: string; seq: number }
  | { type: 'log'; agent: string; level: string; message: string; ts: number; seq: number }
  | { type: 'section_complete'; agent: string; section: string; node: string; data: any; seq: number }
  | { type: 'progress'; progress: number; seq: number }
  | { type: 'run_complete'; progress: number; seq: number }
  | { type: 'run_failed'; message:string; missing_sections:string[]; seq:number }
  | { type: 'error'; node?: string; agent?: string; message: string; seq?: number }
  | { type: 'supervisor_review'; round: number; passed: boolean; assessment: string; directives_count: number; seq?: number }
  | { type: 'supervisor_directive'; agent: string; reason: string; round: number; seq?: number }
  | { type: 'quality_score'; agent: string; passed: boolean; issues: string[]; seq?: number }
  | { type: 'ping' }
  | { type: 'stream_end' }

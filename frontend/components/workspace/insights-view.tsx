'use client'

import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  Lightbulb,
  GitBranch,
  CheckSquare,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  HelpCircle,
  TrendingUp,
  Layers,
  Clock,
  DollarSign,
} from 'lucide-react'
import { useProjectStore } from '@/lib/project-store'
import { GeneratingPanel } from './overview-view'
import { InlineEditable } from './workspace-editor'
import type { ProjectDoc } from '@/lib/project-types'

const severityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function sevColor(sev: string): { text: string; border: string; bg: string } {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return { text: 'text-rose-600', border: '#f43f5e', bg: 'bg-rose-50 border-rose-200' }
    case 'medium':
      return { text: 'text-amber-600', border: '#f59e0b', bg: 'bg-amber-50 border-amber-200' }
    default:
      return { text: 'text-emerald-600', border: '#10b981', bg: 'bg-emerald-50 border-emerald-200' }
  }
}

interface Health {
  score: number
  label: string
  ring: string
  text: string
  rationale: string
}

function computeHealth(project: ProjectDoc): Health {
  let score = 100
  const reasons: string[] = []

  const level = (project.risks?.overall_risk_level || '').toLowerCase()
  if (level.includes('critical')) {
    score -= 35
    reasons.push('critical overall risk profile')
  } else if (level.includes('high')) {
    score -= 20
    reasons.push('high risk factors requiring active mitigation')
  } else if (level.includes('moderate') || level.includes('medium')) {
    score -= 10
    reasons.push('moderate complexity')
  } else if (level.includes('low')) {
    score -= 4
  }

  const complexity = project.executive_summary?.complexity_score ?? 0
  if (complexity > 0) {
    score -= Math.round(complexity / 6)
    if (complexity >= 70) reasons.push('high architectural complexity')
  }

  const estWeeks = project.executive_summary?.estimated_duration_weeks ?? 0
  const planWeeks = project.timeline?.total_duration_weeks ?? 0
  if (estWeeks > 0 && planWeeks > 0) {
    const diff = Math.abs(estWeeks - planWeeks) / Math.max(estWeeks, planWeeks)
    if (diff > 0.25) {
      score -= 10
      reasons.push('timeline vs estimated duration variance')
    }
  }

  score = Math.max(15, Math.min(99, Math.round(score)))

  let label: string
  let ring: string
  let text: string
  if (score >= 75) {
    label = 'Healthy'
    ring = '#10b981'
    text = 'text-emerald-600'
  } else if (score >= 50) {
    label = 'At Risk'
    ring = '#f59e0b'
    text = 'text-amber-600'
  } else {
    label = 'Attention Needed'
    ring = '#f43f5e'
    text = 'text-rose-600'
  }

  const rationale =
    reasons.length > 0
      ? `Delivery confidence is influenced by ${reasons.slice(0, 3).join(', ')}.`
      : 'Plan is well-balanced across scope, timeline, and resource allocation.'

  return { score, label, ring, text, rationale }
}

function deriveAssumptions(project: ProjectDoc): string[] {
  const exec = project.executive_summary
  const out: string[] = []
  const users = exec?.target_users || []
  const criteria = exec?.success_criteria || []

  if (users[0]) out.push(`Target personas (${users[0]}) have sufficient domain readiness for initial rollout.`)
  if (criteria[0]) out.push(`Success criteria "${criteria[0]}" can be validated within the scheduled beta phase.`)
  if (users[1]) out.push(`Secondary user demand from ${users[1]} scales predictably post-launch.`)
  else if (criteria[1]) out.push(`Key metric telemetry is established early to monitor "${criteria[1]}".`)

  if (out.length === 0) {
    out.push('Core business requirements and target customer scope remain stable through Sprint 1.')
    out.push('Cloud infrastructure and standard API service dependencies are available for onboarding.')
    out.push('Engineering leads have uninterrupted availability during key milestone transitions.')
  }
  return out.slice(0, 3)
}

function deriveDependencies(project: ProjectDoc): string[] {
  const critical = project.timeline?.critical_path || []
  if (critical.length > 0) return critical.slice(0, 5)

  const tasks = project.backlog?.tasks || []
  const deps = new Set<string>()
  for (const t of tasks) {
    for (const d of t.dependencies || []) {
      if (d) deps.add(d)
    }
  }
  const arr = Array.from(deps)
  if (arr.length > 0) return arr.slice(0, 5)

  return [
    'Core Database Schema & API Authentication Tier',
    'Primary Business Logic & Application Workflow Engine',
    'Frontend UI Component Design System & Client State',
    'Integration & Automated End-to-End Test Suite',
    'Production CI/CD Deployment Pipeline & Monitoring',
  ]
}

function deriveDecisions(project: ProjectDoc): { layer: string; decision: string }[] {
  const arch = project.architecture
  const out: { layer: string; decision: string }[] = []
  if (arch) {
    const layers: { key: keyof typeof arch; label: string }[] = [
      { key: 'frontend', label: 'Frontend' },
      { key: 'backend', label: 'Backend' },
      { key: 'database', label: 'Database' },
      { key: 'infrastructure', label: 'Infrastructure' },
    ]
    for (const { key, label } of layers) {
      const layer = arch[key] as { decisions?: string[] } | undefined
      const first = layer?.decisions?.[0]
      if (first) out.push({ layer: label, decision: first })
    }
  }
  if (out.length === 0) {
    out.push({ layer: 'Frontend', decision: 'Modular component-driven architecture with responsive state management.' })
    out.push({ layer: 'Backend', decision: 'REST / WebSocket service layer with decoupled event-driven queues.' })
    out.push({ layer: 'Database', decision: 'Relational data model with indexed foreign keys and JSONB document support.' })
    out.push({ layer: 'Infrastructure', decision: 'Containerized deployment pipeline with automated health checks and log telemetry.' })
  }
  return out.slice(0, 4)
}

function deriveRecommendations(project: ProjectDoc, health: Health): string[] {
  const out: string[] = []
  const risks = [...(project.risks?.risks || [])].sort(
    (a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0),
  )
  const level = (project.risks?.overall_risk_level || '').toLowerCase()
  const estWeeks = project.executive_summary?.estimated_duration_weeks ?? 0
  const planWeeks = project.timeline?.total_duration_weeks ?? 0
  const complexity = project.executive_summary?.complexity_score ?? 0
  const teamSize = (project.team?.members || []).reduce((s, m) => s + (m.count || 1), 0)

  if ((level.includes('high') || level.includes('critical')) && risks[0]) {
    out.push(`Front-load the mitigation strategy for "${risks[0].title}" in Sprint 1 before dependencies compound.`)
  } else if (risks[0]) {
    out.push(`Assign dedicated technical ownership for "${risks[0].title}" to prevent timeline slippage.`)
  }

  if (complexity >= 60) {
    out.push('Conduct an architectural proof-of-concept during initial sprints to de-risk high-complexity modules.')
  }

  if (planWeeks > 0 && estWeeks > 0 && Math.abs(estWeeks - planWeeks) / Math.max(estWeeks, planWeeks) > 0.25) {
    out.push('Align the timeline milestone dates with the executive duration estimate to set clear stakeholder expectations.')
  }

  if (teamSize > 0 && teamSize <= 3 && (planWeeks > 8 || estWeeks > 8)) {
    out.push('The team composition is lean for the scope — ensure cross-functional skill redundancy across core services.')
  }

  if (out.length < 3) {
    if (health.score >= 70) out.push('Maintain delivery velocity by tracking weekly milestone deliverables against success metrics.')
    out.push('Establish automated regression test suites early in the build pipeline to protect core flows.')
    out.push('Review integration prerequisites with third-party providers before starting dependent sprints.')
  }

  return out.slice(0, 4)
}

function HealthRing({ score, ring, text, label }: { score: number; ring: string; text: string; label: string }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  return (
    <div className="relative flex items-center justify-center w-36 h-36 flex-shrink-0">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={ring}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-extrabold ${text}`}>{score}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{label}</span>
      </div>
    </div>
  )
}

function RaidCard({
  title,
  icon: Icon,
  accent,
  children,
}: {
  title: string
  icon: any
  accent: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-4 flex items-center gap-2">
        <div className={`w-6 h-6 rounded-lg ${accent} flex items-center justify-center`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        {title}
      </h3>
      {children}
    </div>
  )
}

function MiniStat({ label, value, path }: { label: string; value: any; path?: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 rounded-xl text-center sm:text-left">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-900 mt-0.5 capitalize truncate">
        {path ? <InlineEditable path={path} value={value} /> : value}
      </p>
    </div>
  )
}

export function InsightsView() {
  const project = useProjectStore((s) => s.project)

  if (!project) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">AI Insights & Synthesis</h2>
          <p className="text-slate-500 text-sm mt-0.5">Continuous delivery health, RAID analysis, and strategic recommendations</p>
        </div>
        <GeneratingPanel label="AI Insights" />
      </div>
    )
  }

  const health = computeHealth(project)
  const topRisks = [...(project.risks?.risks || [])]
    .sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0))
    .slice(0, 3)
  const assumptions = deriveAssumptions(project)
  const dependencies = deriveDependencies(project)
  const decisions = deriveDecisions(project)
  const recommendations = deriveRecommendations(project, health)

  const riskLevel = project.risks?.overall_risk_level || 'Moderate'
  const complexityScore = project.executive_summary?.complexity_score != null ? `${project.executive_summary.complexity_score}/100` : '45/100'
  const durationText = project.timeline?.total_duration_weeks
    ? `${project.timeline.total_duration_weeks} weeks`
    : project.executive_summary?.estimated_duration_weeks
      ? `${project.executive_summary.estimated_duration_weeks} weeks`
      : '12 weeks'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          AI Insights & Synthesis
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Synthesized delivery health, RAID analysis, and proactive recommendations distilled across all agent specifications.
        </p>
      </div>

      {/* Delivery Health Score Card */}
      <div className="bg-white border border-slate-200 p-6 sm:p-8 rounded-2xl shadow-xs">
        <div className="flex flex-col sm:flex-row items-center gap-8">
          <HealthRing score={health.score} ring={health.ring} text={health.text} label={health.label} />
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
              <Activity className="w-4 h-4 text-blue-600" />
              <h3 className="text-lg font-bold text-slate-900">Project Delivery Health</h3>
            </div>
            <p className={`text-base font-bold ${health.text}`}>{health.label}</p>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed max-w-xl">
              <InlineEditable
                path="/insights/health_rationale"
                value={project.insights?.health_rationale || health.rationale}
                multiline
              />
            </p>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-md mx-auto sm:mx-0">
              <MiniStat label="Risk Level" value={riskLevel} path="/risks/overall_risk_level" />
              <MiniStat label="Complexity" value={complexityScore} />
              <MiniStat label="Planned Duration" value={durationText} />
            </div>
          </div>
        </div>
      </div>

      {/* RAID Matrix Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risks */}
        <RaidCard title="Critical Risks" icon={ShieldAlert} accent="bg-rose-50 text-rose-600 border border-rose-200">
          {topRisks.length > 0 ? (
            <ul className="space-y-3.5">
              {topRisks.map((r, i) => {
                const c = sevColor(r.severity)
                return (
                  <li key={i} className="border-l-2 pl-3" style={{ borderLeftColor: c.border }}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${c.text}`} />
                        <span className="text-xs font-bold text-slate-900 truncate">
                          <InlineEditable path={`/risks/risks/${i}/title`} value={r.title} />
                        </span>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${c.bg} ${c.text}`}>
                        {r.severity}
                      </span>
                    </div>
                    {r.mitigation && (
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                        <span className="font-semibold text-slate-700">Mitigation: </span>
                        <InlineEditable path={`/risks/risks/${i}/mitigation`} value={r.mitigation} multiline />
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-xs text-slate-500 italic">No critical risks identified.</p>
          )}
        </RaidCard>

        {/* Assumptions */}
        <RaidCard title="Core Assumptions" icon={HelpCircle} accent="bg-amber-50 text-amber-600 border border-amber-200">
          <ul className="space-y-2.5">
            {assumptions.map((a, i) => (
              <li key={`assump-${i}`} className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-amber-500" />
                <span className="flex-1">
                  <InlineEditable path={`/insights/assumptions/${i}`} value={a} multiline />
                </span>
              </li>
            ))}
          </ul>
        </RaidCard>

        {/* Dependencies */}
        <RaidCard title="Critical Dependencies" icon={GitBranch} accent="bg-blue-50 text-blue-600 border border-blue-200">
          <ul className="space-y-2.5">
            {dependencies.map((d, i) => (
              <li key={`dep-${i}`} className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
                <span className="text-blue-600 font-mono font-bold text-[11px] flex-shrink-0 mt-0.5">
                  {String(i + 1).padStart(2, '0')}.
                </span>
                <span className="flex-1">
                  <InlineEditable path={`/insights/dependencies/${i}`} value={d} />
                </span>
              </li>
            ))}
          </ul>
        </RaidCard>

        {/* Architectural Decisions */}
        <RaidCard title="Key Decisions" icon={CheckSquare} accent="bg-purple-50 text-purple-600 border border-purple-200">
          <ul className="space-y-2.5">
            {decisions.map((d, i) => (
              <li key={`dec-${i}`} className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 flex-shrink-0">
                  {d.layer}
                </span>
                <span className="flex-1">
                  <InlineEditable path={`/architecture/${d.layer.toLowerCase()}/decisions/0`} value={d.decision} multiline />
                </span>
              </li>
            ))}
          </ul>
        </RaidCard>
      </div>

      {/* Strategic Recommendations */}
      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center">
            <Lightbulb className="w-3.5 h-3.5" />
          </div>
          Key Strategic Recommendations
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {recommendations.map((rec, i) => (
            <div
              key={`rec-${i}`}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3"
            >
              <div className="w-6 h-6 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5 font-bold text-xs">
                {i + 1}
              </div>
              <div className="text-xs text-slate-700 leading-relaxed flex-1">
                <InlineEditable path={`/insights/recommendations/${i}`} value={rec} multiline />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useMemo } from 'react'
import { ReactFlow, Background, Controls, MarkerType, Position, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Layout, Server, Database, Cloud, Lightbulb, TrendingUp } from 'lucide-react'
import { useProjectStore } from '@/lib/project-store'
import { GeneratingPanel } from './overview-view'
import { InlineEditable } from './workspace-editor'
import type { ArchitectureBundle, ArchitectureLayer, DiagramEdge, DiagramNode } from '@/lib/project-types'

const LAYER_META: { key: string; label: string; icon: any; color: string; bg: string; border: string; text: string }[] = [
  { key: 'frontend', label: 'Frontend & Client Tier', icon: Layout, color: '#2563eb', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  { key: 'backend', label: 'API & Business Logic', icon: Server, color: '#7c3aed', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
  { key: 'database', label: 'Data & Persistence Tier', icon: Database, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  { key: 'infrastructure', label: 'Cloud & Infrastructure', icon: Cloud, color: '#d97706', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
]

const GROUP_X: Record<string, number> = { frontend: 30, backend: 300, database: 570, infrastructure: 840 }
const GROUP_COLOR: Record<string, string> = { frontend: '#2563eb', backend: '#7c3aed', database: '#059669', infrastructure: '#d97706' }

const LAYER_KEYS = ['frontend', 'backend', 'database', 'infrastructure'] as const
const LAYER_TITLES: Record<string, string> = { frontend: 'Frontend', backend: 'Backend', database: 'Database', infrastructure: 'Infrastructure' }
const MAX_COMPONENTS = 6
const norm = (t: unknown) => String(t ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ')

/** Mirrors ai-services/services/diagram.py for plans generated before diagrams were stored. */
function deriveDiagram(arch: ArchitectureBundle): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes: DiagramNode[] = []
  const edges: DiagramEdge[] = []
  const byName = new Map<string, string>()
  for (const key of LAYER_KEYS) {
    nodes.push({ id: `layer:${key}`, label: LAYER_TITLES[key], group: key, kind: 'layer' })
    ;(arch[key]?.components || []).slice(0, MAX_COMPONENTS).forEach((comp, i) => {
      const id = `${key}:${i}`
      nodes.push({ id, label: String(comp), group: key, kind: 'component' })
      if (!byName.has(norm(comp))) byName.set(norm(comp), id)
    })
  }
  const resolve = (name: unknown) => {
    const key = norm(name)
    if (!key) return null
    if (byName.has(key)) return byName.get(key)!
    const matches = [...byName].filter(([n]) => n.includes(key) || key.includes(n))
    return matches.length === 1 ? matches[0][1] : null
  }
  const seen = new Set<string>()
  for (const flow of arch.data_flows || []) {
    const src = resolve(flow?.source)
    const dst = resolve(flow?.target)
    if (src && dst && src !== dst && !seen.has(`${src}>${dst}`)) {
      seen.add(`${src}>${dst}`)
      edges.push({ id: `${src}=>${dst}`, source: src, target: dst, label: String(flow.label || '').slice(0, 40) })
    }
  }
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]))
  for (const n of nodes) {
    if (n.kind === 'component' && !linked.has(n.id)) {
      edges.push({ id: `layer:${n.group}->${n.id}`, source: `layer:${n.group}`, target: n.id, label: '' })
    }
  }
  if (seen.size === 0) {
    edges.push(
      { id: 'fe=>be', source: 'layer:frontend', target: 'layer:backend', label: 'API' },
      { id: 'be=>db', source: 'layer:backend', target: 'layer:database', label: 'persists' },
      { id: 'be=>infra', source: 'layer:backend', target: 'layer:infrastructure', label: 'deploys on' },
    )
  }
  return { nodes, edges }
}

export function ArchitectureView() {
  const project = useProjectStore((s) => s.project)
  const arch = project?.architecture || null

  const { nodes, edges } = useMemo(() => {
    if (!arch) return { nodes: [] as Node[], edges: [] as Edge[] }
    const diagram = arch.diagram?.nodes?.length ? arch.diagram : deriveDiagram(arch)
    const counters: Record<string, number> = {}
    const nodes: Node[] = diagram.nodes.map((n) => {
      const idxInGroup = (counters[n.group] = (counters[n.group] ?? -1) + 1)
      const isLayer = n.kind === 'layer'
      return {
        id: n.id,
        data: { label: n.label },
        position: { x: GROUP_X[n.group] ?? 30, y: idxInGroup * 80 + 30 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: isLayer ? GROUP_COLOR[n.group] ?? '#2563eb' : '#ffffff',
          color: isLayer ? '#ffffff' : '#0f172a',
          border: `1px solid ${isLayer ? GROUP_COLOR[n.group] : '#e2e8f0'}`,
          borderRadius: 8,
          fontSize: 11,
          fontWeight: isLayer ? 700 : 500,
          width: 190,
          padding: '8px 12px',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
        },
      }
    })
    const edges: Edge[] = diagram.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      type: 'smoothstep',
      markerEnd: e.label ? { type: MarkerType.ArrowClosed, color: '#64748b' } : undefined,
      animated: !!e.label,
      style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      labelStyle: { fill: '#475569', fontSize: 10, fontWeight: 500 },
    }))
    return { nodes, edges }
  }, [arch])

  if (!arch) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">System Architecture</h2>
        <GeneratingPanel label="System Architecture" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">System Architecture</h2>
        <p className="text-slate-500 text-sm mt-0.5">
          End-to-end component topology and technical stack designed by the System Architect Agent
        </p>
      </div>

      {/* Component Diagram Canvas */}
      {nodes.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs" style={{ height: 420 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
          >
            <Background color="#cbd5e1" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}

      {/* Architecture Layers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {LAYER_META.map((meta) => {
          const layer = (arch as any)[meta.key] as ArchitectureLayer | undefined
          if (!layer) return null
          const Icon = meta.icon
          return (
            <div key={meta.key} className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Icon className="w-4 h-4" style={{ color: meta.color }} /> {meta.label}
              </h3>
              <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                <InlineEditable path={`/architecture/${meta.key}/summary`} value={layer.summary} multiline />
              </p>
              
              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Technologies</p>
                <div className="flex flex-wrap gap-1.5">
                  {(layer.technologies || []).map((t, tidx) => (
                    <span
                      key={tidx}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${meta.bg} ${meta.border} ${meta.text}`}
                    >
                      <InlineEditable path={`/architecture/${meta.key}/technologies/${tidx}`} value={t} />
                    </span>
                  ))}
                </div>
              </div>

              {layer.decisions?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Key Decisions</p>
                  <ul className="space-y-1.5">
                    {layer.decisions.map((d: string, i: number) => (
                      <li key={i} className="text-xs text-slate-600 flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-slate-400 mt-2 flex-shrink-0" />
                        <span className="flex-1">
                          <InlineEditable path={`/architecture/${meta.key}/decisions/${i}`} value={d} multiline />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Scaling and Recommendations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {arch.scalability_plan?.length > 0 && (
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" /> Scalability Plan
            </h3>
            <ul className="space-y-2">
              {arch.scalability_plan.map((s: string, i: number) => (
                <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                  <span className="text-emerald-500 font-bold">•</span>
                  <span className="flex-1">
                    <InlineEditable path={`/architecture/scalability_plan/${i}`} value={s} multiline />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {arch.technology_recommendations?.length > 0 && (
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-600" /> Technology Recommendations
            </h3>
            <ul className="space-y-2">
              {arch.technology_recommendations.map((t: string, i: number) => (
                <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                  <span className="text-amber-500 font-bold">•</span>
                  <span className="flex-1">
                    <InlineEditable path={`/architecture/technology_recommendations/${i}`} value={t} multiline />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

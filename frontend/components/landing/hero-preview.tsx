'use client'

import { motion } from 'framer-motion'
import {
  Crown, ClipboardList, Boxes, ListChecks, ShieldAlert, Users, CalendarRange, Plug,
  FileText, GitBranch, DollarSign, TriangleAlert,
} from 'lucide-react'

const AGENTS = [
  { icon: Crown, label: 'CEO' },
  { icon: ClipboardList, label: 'PM' },
  { icon: Boxes, label: 'Architect' },
  { icon: ListChecks, label: 'Sprints' },
  { icon: ShieldAlert, label: 'Risk' },
  { icon: Users, label: 'Team' },
  { icon: CalendarRange, label: 'Timeline' },
  { icon: Plug, label: 'DevOps' },
]

const TILES = [
  { icon: FileText, label: 'PRD Requirements', value: '24', color: 'text-blue-600' },
  { icon: GitBranch, label: 'Backlog Tasks', value: '38', color: 'text-purple-600' },
  { icon: CalendarRange, label: 'Timeline Duration', value: '14 wks', color: 'text-indigo-600' },
  { icon: DollarSign, label: 'Estimated Budget', value: '$184k', color: 'text-emerald-600' },
]

const CYCLE = 6

export function HeroPreview() {
  return (
    <div className="relative max-w-4xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        {/* Window Chrome */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <span className="w-3 h-3 rounded-full bg-rose-400" />
          <span className="w-3 h-3 rounded-full bg-amber-400" />
          <span className="w-3 h-3 rounded-full bg-emerald-400" />
          <div className="ml-3 flex-1 max-w-xs rounded-md bg-white border border-slate-200 px-3 py-1 text-[11px] font-mono text-slate-500 shadow-xs">
            https://devflow.ai/workspace/recruitment-platform
          </div>
        </div>

        <div className="p-5 sm:p-7">
          {/* Prompt Intake */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs sm:text-sm">
            <span className="text-blue-600 font-bold">⌁</span>
            <span className="text-slate-800 font-medium">Build an autonomous AI-powered hiring & candidate screening platform for high-growth tech teams</span>
            <motion.span
              className="ml-0.5 inline-block w-1.5 h-4 bg-blue-600"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          </div>

          {/* Agent Pipeline */}
          <div className="mt-5 grid grid-cols-4 sm:grid-cols-8 gap-2">
            {AGENTS.map((a, i) => {
              const start = (i / AGENTS.length) * 0.7
              return (
                <motion.div
                  key={a.label}
                  className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white py-2 shadow-xs"
                  animate={{
                    borderColor: ['#e5e5e5', '#0a0a0a', '#0a0a0a', '#e5e5e5'],
                    backgroundColor: ['#ffffff', '#f5f5f5', '#f5f5f5', '#ffffff'],
                  }}
                  transition={{ duration: CYCLE, times: [start, start + 0.08, start + 0.18, 1], repeat: Infinity, ease: 'easeInOut' }}
                >
                  <a.icon className="w-4 h-4 text-blue-600" />
                  <span className="text-[10px] font-semibold text-slate-600">{a.label}</span>
                </motion.div>
              )
            })}
          </div>

          {/* Progress Bar */}
          <div className="mt-4 h-1.5 w-full rounded-full bg-slate-100 border border-slate-200 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-blue-600"
              animate={{ width: ['0%', '100%'] }}
              transition={{ duration: CYCLE * 0.82, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          {/* Result Tiles */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TILES.map((t, i) => (
              <motion.div
                key={t.label}
                className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 shadow-xs"
                animate={{ opacity: [0.3, 0.3, 1, 1], y: [6, 6, 0, 0] }}
                transition={{ duration: CYCLE, times: [0, 0.55 + i * 0.06, 0.68 + i * 0.06, 1], repeat: Infinity }}
              >
                <t.icon className={`w-4 h-4 ${t.color}`} />
                <div className="mt-1.5 text-lg font-bold text-slate-900">{t.value}</div>
                <div className="text-[11px] font-medium text-slate-500">{t.label}</div>
              </motion.div>
            ))}
          </div>

          {/* Footer Hint */}
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 font-medium">
            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />
            6 critical security risks evaluated with OWASP compliance and mitigation roadmaps.
          </div>
        </div>
      </div>
    </div>
  )
}

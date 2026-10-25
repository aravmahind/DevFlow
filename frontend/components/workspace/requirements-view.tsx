'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, BookOpen, Layers } from 'lucide-react'
import { useProjectStore } from '@/lib/project-store'
import { GeneratingPanel } from './overview-view'
import { InlineEditable } from './workspace-editor'
import type { RequirementItem } from '@/lib/project-types'

const priorityClass: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function RequirementRow({ req, idx, section }: { req: RequirementItem; idx: number; section: 'functional_requirements' | 'non_functional_requirements' }) {
  return (
    <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl hover:border-slate-300 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <InlineEditable path={`/requirements/${section}/${idx}/title`} value={req.title} className="font-semibold text-xs text-slate-900" />
            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-white border border-slate-200 text-slate-500">
              {req.category}
            </span>
          </div>
          {req.description && (
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed"><InlineEditable path={`/requirements/${section}/${idx}/description`} value={req.description} multiline /></p>
          )}
        </div>
        <div className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${priorityClass[req.priority] || priorityClass.medium}`}>
          {req.priority.toUpperCase()}
        </div>
      </div>
    </div>
  )
}

export function RequirementsView() {
  const project = useProjectStore((s) => s.project)
  const reqs = project?.requirements || null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Product Requirements (PRD)</h2>
        <p className="text-slate-500 text-sm mt-0.5">
          Functional and non-functional specifications compiled by the Product Manager Agent
        </p>
      </div>

      {!reqs ? (
        <GeneratingPanel label="Requirements" />
      ) : (
        <>
          {/* Functional Reqs */}
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              Functional Requirements
            </h3>
            <div className="space-y-3">
                {reqs.functional_requirements.map((req, idx) => (
                <RequirementRow key={`f-${idx}`} req={req} idx={idx} section="functional_requirements" />
              ))}
            </div>
          </div>

          {/* Non-Functional Reqs */}
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-indigo-600" />
              Non-Functional Requirements & Constraints
            </h3>
            <div className="space-y-3">
                {reqs.non_functional_requirements.map((req, idx) => (
                <RequirementRow key={`n-${idx}`} req={req} idx={idx} section="non_functional_requirements" />
              ))}
            </div>
          </div>

          {/* User Stories */}
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" /> User Stories & Acceptance Criteria
            </h3>
            <div className="space-y-4">
              {reqs.user_stories.map((story, idx) => (
                <div key={`story-${idx}`} className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xs text-slate-900 leading-relaxed font-medium flex flex-wrap items-center gap-1.5">
                    <span className="text-blue-600 font-bold">As a</span>
                    <InlineEditable path={`/requirements/user_stories/${idx}/as_a`} value={story.as_a} className="font-semibold text-slate-900" />,
                    <span className="text-blue-600 font-bold">I want</span>
                    <InlineEditable path={`/requirements/user_stories/${idx}/i_want`} value={story.i_want} multiline className="font-medium text-slate-900" />,
                    <span className="text-blue-600 font-bold">so that</span>
                    <InlineEditable path={`/requirements/user_stories/${idx}/so_that`} value={story.so_that} multiline className="text-slate-700" />.
                  </div>
                  {story.acceptance_criteria?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200/80">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Acceptance Criteria
                      </span>
                      <ul className="space-y-1.5">
                        {story.acceptance_criteria.map((c, i) => (
                          <li key={`ac-${idx}-${i}`} className="flex items-start gap-2 text-xs text-slate-600">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                            <span className="flex-1">
                              <InlineEditable path={`/requirements/user_stories/${idx}/acceptance_criteria/${i}`} value={c} multiline />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Scope Boxes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
              <h3 className="text-xs font-bold text-emerald-700 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> In Scope (MVP)
              </h3>
              <ul className="space-y-2">
                {reqs.scope_in.map((s, i) => (
                  <li key={`scopein-${i}`} className="text-xs text-slate-700 flex gap-2 items-start">
                    <span className="text-emerald-600 font-bold">+</span>
                    <span className="flex-1">
                      <InlineEditable path={`/requirements/scope_in/${i}`} value={s} multiline />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
              <h3 className="text-xs font-bold text-rose-700 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500" /> Out of Scope (Future)
              </h3>
              <ul className="space-y-2">
                {reqs.scope_out.map((s, i) => (
                  <li key={`scopeout-${i}`} className="text-xs text-slate-700 flex gap-2 items-start">
                    <span className="text-rose-500 font-bold">−</span>
                    <span className="flex-1">
                      <InlineEditable path={`/requirements/scope_out/${i}`} value={s} multiline />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

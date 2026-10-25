'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, ShieldCheck, TrendingDown, ShieldAlert } from 'lucide-react'
import { useProjectStore } from '@/lib/project-store'
import { GeneratingPanel } from './overview-view'
import { InlineEditable } from './workspace-editor'

const severityClass: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  low: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
}

export function RiskView() {
  const project = useProjectStore((s) => s.project)
  const riskData = project?.risks || null
  const risks = riskData?.risks || []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Security & Delivery Risk Assessment</h2>
        <p className="text-slate-500 text-sm mt-0.5">
          {riskData ? (
            <span>
              Overall project risk profile: <InlineEditable path="/risks/overall_risk_level" value={riskData.overall_risk_level} className="font-semibold text-slate-900" />
            </span>
          ) : (
            'Security and technical debt analysis'
          )}
        </p>
      </div>

      {!riskData ? (
        <GeneratingPanel label="Risk & Security Analysis" />
      ) : (
        <>
          {riskData.summary && (
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs text-xs text-slate-700 leading-relaxed">
              <strong className="text-slate-900 block mb-1 uppercase tracking-wider text-[11px]">Executive Threat Summary</strong>
              <InlineEditable path="/risks/summary" value={riskData.summary} multiline />
            </div>
          )}

          {/* Risk Matrix counts */}
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">Risk Severity Breakdown</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Low', count: risks.filter((r) => r.severity === 'low').length, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                { label: 'Medium', count: risks.filter((r) => r.severity === 'medium').length, tone: 'bg-amber-50 text-amber-700 border-amber-200' },
                { label: 'High', count: risks.filter((r) => r.severity === 'high').length, tone: 'bg-orange-50 text-orange-700 border-orange-200' },
                { label: 'Critical', count: risks.filter((r) => r.severity === 'critical').length, tone: 'bg-rose-50 text-rose-700 border-rose-200' },
              ].map((item) => (
                <div key={item.label} className={`p-4 rounded-xl border ${item.tone} text-center`}>
                  <p className="text-xs font-semibold uppercase tracking-wider">{item.label}</p>
                  <p className="text-2xl font-bold mt-1">{item.count}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Cards */}
          <div className="space-y-3">
            {risks.map((risk, idx) => {
              const tone = severityClass[risk.severity] || severityClass.medium
              return (
                <div key={`risk-${idx}`} className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg border ${tone.bg} ${tone.border} ${tone.text} flex-shrink-0 mt-0.5`}>
                      <ShieldAlert className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <h4 className="font-bold text-sm text-slate-900 flex-1">
                          <InlineEditable path={`/risks/risks/${idx}/title`} value={risk.title} />
                        </h4>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${tone.bg} ${tone.border} ${tone.text}`}>
                          {risk.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                        <InlineEditable path={`/risks/risks/${idx}/description`} value={risk.description} multiline />
                      </p>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                        <Bar label="Probability" value={risk.probability} />
                        <Bar label="Impact" value={risk.impact} />
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</p>
                          <p className="text-xs font-semibold text-slate-700 capitalize mt-1">
                            <InlineEditable path={`/risks/risks/${idx}/category`} value={risk.category} />
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-1">
                          <TrendingDown className="w-3.5 h-3.5 text-blue-600" /> Recommended Mitigation Plan
                        </p>
                        <p className="text-xs text-slate-800 leading-relaxed font-medium">
                          <InlineEditable path={`/risks/risks/${idx}/mitigation`} value={risk.mitigation} multiline />
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${value}%` }} />
        </div>
        <span className="text-xs font-bold text-slate-700">{value}%</span>
      </div>
    </div>
  )
}

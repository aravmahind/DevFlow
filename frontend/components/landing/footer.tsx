'use client'

import { motion } from 'framer-motion'
import { ShieldCheck, Lock, Download } from 'lucide-react'
import { Reveal } from './reveal'
import Link from 'next/link'

const TRUST_BADGES = [
  { icon: ShieldCheck, label: 'SOC 2 & ISO 27001' },
  { icon: Lock, label: 'GDPR & Privacy Compliant' },
  { icon: Download, label: 'Zero Lock-in Export' },
] as const

const LINK_COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Platform',
    links: [
      { label: 'How It Works', href: '#how' },
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Migration Wizard', href: '#migrate' },
    ],
  },
  {
    heading: 'Engineering',
    links: [
      { label: 'My Projects', href: '/my-projects' },
      { label: 'My Tasks', href: '/my-tasks' },
    ],
  },
]

export function LandingFooter() {
  const handleNav = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (href.startsWith('/')) return
    const el = document.querySelector(href)
    if (el) {
      e.preventDefault()
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <footer id="footer" className="relative px-4 pt-16 pb-12 border-t border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-8">
            {/* Brand + tagline */}
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  DF
                </div>
                <span className="text-xl font-bold tracking-tight text-slate-900">
                  Dev<span className="text-blue-600">flow</span>
                </span>
              </div>

              <p className="mt-3 max-w-sm text-xs sm:text-sm text-slate-600 leading-relaxed">
                The autonomous AI organization that plans, architects, estimates, and risk-audits your software delivery before you write code.
              </p>

              <ul className="mt-6 flex flex-wrap gap-2">
                {TRUST_BADGES.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                      <Icon className="w-3.5 h-3.5 text-blue-600" />
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Link columns */}
            <nav aria-label="Footer" className="grid grid-cols-2 gap-8">
              {LINK_COLUMNS.map((column) => (
                <div key={column.heading}>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    {column.heading}
                  </h3>
                  <ul className="mt-4 space-y-2.5">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          onClick={handleNav(link.href)}
                          className="text-xs text-slate-500 transition-colors hover:text-blue-600 font-medium"
                        >
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-6 sm:flex-row text-xs text-slate-400">
            <p>© 2026 Devflow Inc. All rights reserved.</p>
            <p>Powered by Groq LLaMA 3.3 & LangGraph Multi-Agent Orchestration.</p>
          </div>
        </Reveal>
      </div>
    </footer>
  )
}

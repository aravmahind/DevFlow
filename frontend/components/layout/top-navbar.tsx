'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from '@/lib/project-store'
import { useAppUser, useAppAuth } from '@/lib/auth-context'
import { Menu, Search, LogIn, Sparkles, ListChecks, FolderKanban, Cpu } from 'lucide-react'

export function TopNavbar() {
  const pathname = usePathname()
  const isProjectShell = pathname?.startsWith('/workspace')
  const { projectTitle, sidebarCollapsed, setSidebarCollapsed, aiPanelOpen, setAiPanelOpen, accountPanelOpen, setAccountPanelOpen } = useAppStore(useShallow((s) => ({ projectTitle: s.projectTitle, sidebarCollapsed: s.sidebarCollapsed, setSidebarCollapsed: s.setSidebarCollapsed, aiPanelOpen: s.aiPanelOpen, setAiPanelOpen: s.setAiPanelOpen, accountPanelOpen: s.accountPanelOpen, setAccountPanelOpen: s.setAccountPanelOpen })))
  const { user, isSignedIn, isLoaded } = useAppUser()
  const { signIn } = useAppAuth()

  return (
    <nav className="fixed top-3 left-3 right-3 z-40 px-4 py-2.5 rounded-2xl liquid-glass">
      <div className="flex items-center justify-between gap-4">
        {/* Left side */}
        <div className="flex items-center gap-3">
          {isProjectShell && (
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
              title="Toggle Sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 bg-slate-950 rounded-lg flex items-center justify-center shadow-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M4 12h16M4 17h7" /></svg>
            </div>
            <span className="font-bold text-slate-950 text-base tracking-tight hidden sm:inline">DevFlow</span>
          </Link>
          
          {isProjectShell && projectTitle && (
            <>
              <span className="hidden sm:inline text-slate-300">/</span>
              <span className="font-medium text-slate-600 text-sm hidden sm:inline truncate max-w-[240px]">
                {projectTitle}
              </span>
            </>
          )}

          {/* Status Badge */}
          {isProjectShell && <RunStatusChip />}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 ml-auto">
          {/* My Projects */}
          <Link href="/my-projects">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-transparent">
              <FolderKanban className="w-4 h-4 text-slate-500" />
              <span className="hidden sm:inline">Projects</span>
            </button>
          </Link>

          {/* My Tasks */}
          <Link href="/my-tasks">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-transparent">
              <ListChecks className="w-4 h-4 text-slate-500" />
              <span className="hidden sm:inline">Tasks</span>
            </button>
          </Link>

          {/* Copilot Toggle */}
          {isProjectShell && (
            <button
              onClick={() => setAiPanelOpen(!aiPanelOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                aiPanelOpen
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Flowmate</span>
            </button>
          )}

          {/* User Section */}
          {!isLoaded ? (
            <div className="w-8 h-8 rounded-lg bg-slate-100 animate-pulse" />
          ) : isSignedIn && user ? (
            <button
              onClick={() => setAccountPanelOpen(!accountPanelOpen)}
              className="w-8 h-8 rounded-lg overflow-hidden border border-slate-200 hover:border-blue-400 transition-all flex items-center justify-center bg-slate-50 shadow-sm"
            >
              <img
                src={user.imageUrl}
                alt={user.fullName}
                className="w-full h-full object-cover"
              />
            </button>
          ) : (
            <button
              onClick={() => signIn()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" /> Sign In
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Agents working',
  awaiting_approval: 'Waiting for your approval',
  complete: 'Plan complete',
  failed: 'Run failed',
  stopped: 'Stopped',
}

/** The project's real run state (was a static "AI Pipeline Ready" badge). */
function RunStatusChip() {
  const status = useProjectStore((s) => s.status)
  const progress = useProjectStore((s) => s.progress)
  const label = STATUS_LABEL[status]
  if (!label) return null
  const live = status === 'running' || status === 'queued'
  const needsYou = status === 'awaiting_approval' || status === 'failed'
  return (
    <div
      className={`hidden md:inline-flex items-center gap-2 ml-2 px-2.5 py-1 rounded-full text-xs font-medium ${
        live || needsYou ? 'bg-slate-950 text-white' : 'bg-white/70 border border-slate-200 text-slate-700'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          live ? 'bg-signal signal-pulse' : needsYou ? 'bg-signal' : status === 'complete' ? 'bg-slate-950' : 'bg-slate-400'
        }`}
      />
      {label}
      {live && <span className="tabular-nums text-white/70">{progress}%</span>}
    </div>
  )
}

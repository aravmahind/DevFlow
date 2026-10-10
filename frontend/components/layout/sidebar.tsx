'use client'

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore, type WorkspaceMode } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from '@/lib/project-store'
import Link from 'next/link'
import {
  Activity,
  LayoutDashboard,
  FileText,
  Network,
  ListChecks,
  KanbanSquare,
  ShieldAlert,
  ShieldCheck,
  CalendarRange,
  DollarSign,
  Users,
  Plug,
  Sparkles,
  BookOpen,
  Settings,
  Loader2,
  ArrowLeft,
  FolderKanban,
  Github,
} from 'lucide-react'

interface SidebarItem {
  mode: WorkspaceMode
  label: string
  icon: React.ReactElement<{ className?: string }>
}

interface SidebarGroup {
  label: string
  items: SidebarItem[]
}

const groups: SidebarGroup[] = [
  {
    label: 'Live AI Org',
    items: [
      { mode: 'track-live', label: 'Track Live', icon: <Activity /> },
    ],
  },
  {
    label: 'Plan',
    items: [
      { mode: 'overview', label: 'Overview', icon: <LayoutDashboard /> },
      { mode: 'requirements', label: 'Requirements', icon: <FileText /> },
      { mode: 'architecture', label: 'Architecture', icon: <Network /> },
    ],
  },
  {
    label: 'Build',
    items: [
      { mode: 'backlog', label: 'Backlog', icon: <ListChecks /> },
      { mode: 'sprint', label: 'Sprint Board', icon: <KanbanSquare /> },
      { mode: 'github', label: 'GitHub Tracker', icon: <Github /> },
      { mode: 'risks', label: 'Risks', icon: <ShieldAlert /> },
    ],
  },
  {
    label: 'Deliver',
    items: [
      { mode: 'milestones', label: 'Timeline', icon: <CalendarRange /> },
      { mode: 'cost', label: 'Cost & Budget', icon: <DollarSign /> },
      { mode: 'team', label: 'AI Organization', icon: <Users /> },
      { mode: 'members', label: 'Team Members', icon: <ShieldCheck /> },
      { mode: 'integrations', label: 'Deployment Strategy', icon: <Plug /> },
    ],
  },
  {
    label: 'Manage',
    items: [
      { mode: 'insights', label: 'AI Insights', icon: <Sparkles /> },
      { mode: 'documentation', label: 'Docs & Export', icon: <BookOpen /> },
    ],
  },
]

export function Sidebar() {
  const { sidebarCollapsed, activeWorkspaceMode, setActiveWorkspaceMode } = useAppStore(useShallow((s) => ({ sidebarCollapsed: s.sidebarCollapsed, activeWorkspaceMode: s.activeWorkspaceMode, setActiveWorkspaceMode: s.setActiveWorkspaceMode })))
  const status = useProjectStore((s) => s.status)
  const progress = useProjectStore((s) => s.progress)

  return (
    <aside
      className={`fixed left-0 top-0 h-screen pt-16 bg-white border-r border-slate-200 z-30 flex flex-col justify-between transition-all duration-200 ${
        sidebarCollapsed ? 'w-[70px]' : 'w-[230px]'
      }`}
    >
      <div className="flex-1 overflow-y-auto scrollbar-hide p-3 flex flex-col">
        <nav className="space-y-3 mt-1">
          <div className="mb-2">
            <Link
              href="/my-projects"
              className="w-full px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-600 hover:bg-blue-50/60 transition-colors border border-transparent"
              title="Back to all projects"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              {!sidebarCollapsed && <span>All Projects</span>}
            </Link>
          </div>

          {groups.map((group) => (
            <div key={group.label}>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = activeWorkspaceMode === item.mode
                  const isTrackLive = item.mode === 'track-live'
                  const isRunning = isTrackLive && (status === 'running' || status === 'queued')

                  return (
                    <button
                      key={item.mode}
                      onClick={() => setActiveWorkspaceMode(item.mode)}
                      title={item.label}
                      className={`w-full px-3 py-2 rounded-lg transition-all flex items-center justify-between text-left text-xs font-medium ${
                        active
                          ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-100 shadow-xs'
                          : isRunning
                          ? 'bg-blue-50/40 text-blue-800 font-semibold border border-blue-200/60'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex-shrink-0">
                          {React.cloneElement(item.icon, {
                            className: `w-4 h-4 transition-colors ${active || isRunning ? 'text-blue-600' : 'text-slate-500'}`,
                          })}
                        </span>
                        {!sidebarCollapsed && (
                          <span className="whitespace-nowrap overflow-hidden truncate">{item.label}</span>
                        )}
                      </div>
                      {!sidebarCollapsed && isRunning && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-100/80 px-1.5 py-0.5 rounded">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span>{progress}%</span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto pt-2">
          <div className="my-2 border-t border-slate-200" />
          <Link
            href="/settings"
            className="w-full px-3 py-2 rounded-lg flex items-center gap-2.5 text-left text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4 flex-shrink-0 text-slate-400" />
            {!sidebarCollapsed && <span className="whitespace-nowrap">Settings</span>}
          </Link>
        </div>
      </div>
    </aside>
  )
}

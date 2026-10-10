'use client'

import { motion } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { TopNavbar } from './top-navbar'
import { Sidebar } from './sidebar'
import { AiAssistant } from './ai-assistant'
import { AccountPanel } from './account-panel'
import { useAppStore } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from '@/lib/project-store'

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarCollapsed } = useAppStore(useShallow((s) => ({ sidebarCollapsed: s.sidebarCollapsed })))
  const searchParams = useSearchParams()
  const storeProjectId = useProjectStore((s) => s.projectId)
  const hasProject = Boolean(searchParams?.get('project') || storeProjectId)

  return (
    <div className="w-screen h-screen bg-background overflow-hidden">
      <TopNavbar />
      {hasProject && <Sidebar />}
      <AccountPanel />

      <motion.main
        className="pt-16 transition-all duration-200 h-[calc(100vh-64px)] overflow-y-auto bg-slate-50"
        animate={{ marginLeft: hasProject ? (sidebarCollapsed ? '70px' : '230px') : '0px' }}
        transition={{ duration: 0.2 }}
      >
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </motion.main>

      {/* Floating, collapsible AI copilot (grounded in the active project). */}
      {hasProject && <AiAssistant />}
    </div>
  )
}

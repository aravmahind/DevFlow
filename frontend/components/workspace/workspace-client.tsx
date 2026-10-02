'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { FolderKanban, Plus } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { useProjectStore } from '@/lib/project-store'
import { useOrchestrationStream } from '@/lib/use-orchestration-stream'
import { OverviewView } from './overview-view'
import { ArchitectureView } from './architecture-view'
import { RequirementsView } from './requirements-view'
import { BacklogView } from './backlog-view'
import { RiskView } from './risk-view'

import { IntegrationsView } from './integrations-view'
import { SprintBoardView } from './sprint-board-view'
import { InsightsView } from './insights-view'
import { DocumentationView } from './documentation-view'
import { OrchestrationLoader } from './orchestration-loader'
import { WorkspaceEditProvider } from './workspace-editor'
import { TeamManagement } from './team-management'
import { ProjectRoleProvider } from '@/components/auth/permission-guard'

export function WorkspaceClient() {
  const router = useRouter()
  const { activeWorkspaceMode, setActiveWorkspaceMode, setProjectTitle, setProjectDescription } = useAppStore()
  const setProjectId = useProjectStore((s) => s.setProjectId)
  const reset = useProjectStore((s) => s.reset)
  const project = useProjectStore((s) => s.project)

  const searchParams = useSearchParams()
  const projectId = searchParams?.get('project')

  useEffect(() => {
    if (!projectId) {
      router.replace('/my-projects')
      return
    }
    reset()
    setProjectId(projectId)
  }, [projectId, reset, setProjectId, router])

  useOrchestrationStream(projectId || null)

  useEffect(() => {
    if (!project) return
    const title = project.executive_summary?.project_title || project.title
    if (title) setProjectTitle(title)
    const desc = project.executive_summary?.tagline || project.executive_summary?.overview || project.idea
    if (desc) setProjectDescription(desc)
  }, [project, setProjectTitle, setProjectDescription])

  if (!projectId) {
    return (
      <div className="py-24 text-center">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center mx-auto mb-4 shadow-xs">
          <FolderKanban className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">No project selected</h2>
        <p className="text-slate-500 text-sm mt-1 mb-6">Select a project from your account or plan a new one.</p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/my-projects">
            <button className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer">
              Go to My Projects
            </button>
          </Link>
          <Link href="/projects/new">
            <button className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              New Project
            </button>
          </Link>
        </div>
      </div>
    )
  }

  const renderView = () => {
    switch (activeWorkspaceMode) {
      case 'track-live':
        return <OrchestrationLoader onDismiss={() => setActiveWorkspaceMode('overview')} />
      case 'overview':
        return <OverviewView />
      case 'insights':
        return <InsightsView />
      case 'documentation':
        return <DocumentationView />
      case 'requirements':
      case 'prerequisites':
        return <RequirementsView />
      case 'architecture':
      case 'tech-stack':
        return <ArchitectureView />
      case 'backlog':
        return <BacklogView />
      case 'sprint':
        return <SprintBoardView />
      case 'risks':
        return <RiskView />
      case 'cost':
        // return <CostView />
      case 'team':
        // return <TeamView />
      case 'members':
        return <TeamManagement />
      case 'milestones':
      case 'timeline':
        // return <MilestonesView />
      case 'integrations':
        return <IntegrationsView />
      default:
        return <OverviewView />
    }
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <WorkspaceEditProvider>
        <div className="w-full">{renderView()}</div>
      </WorkspaceEditProvider>
    </ProjectRoleProvider>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { FolderKanban, Plus } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { useProjectStore } from '@/lib/project-store'
import { useOrchestrationStream } from '@/lib/use-orchestration-stream'
import dynamic from 'next/dynamic'
import { WorkspaceEditProvider } from './workspace-editor'
import { ProjectRoleProvider } from '@/components/auth/permission-guard'
import { isWorkspaceMode } from '@/lib/store'

// Views are code-split: opening a project downloads only the view on screen
// (the architecture diagram library alone is sizeable).
const loading = () => <div className="py-16 flex justify-center"><div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" /></div>
const OverviewView = dynamic(() => import('./overview-view').then((m) => m.OverviewView), { loading })
const ArchitectureView = dynamic(() => import('./architecture-view').then((m) => m.ArchitectureView), { loading, ssr: false })
const RequirementsView = dynamic(() => import('./requirements-view').then((m) => m.RequirementsView), { loading })
const BacklogView = dynamic(() => import('./backlog-view').then((m) => m.BacklogView), { loading })
const RiskView = dynamic(() => import('./risk-view').then((m) => m.RiskView), { loading })
const IntegrationsView = dynamic(() => import('./integrations-view').then((m) => m.IntegrationsView), { loading })
const SprintBoardView = dynamic(() => import('./sprint-board-view').then((m) => m.SprintBoardView), { loading })
const InsightsView = dynamic(() => import('./insights-view').then((m) => m.InsightsView), { loading })
const DocumentationView = dynamic(() => import('./documentation-view').then((m) => m.DocumentationView), { loading })
const GithubView = dynamic(() => import('./github-view').then((m) => m.GithubView), { loading })
const OrchestrationLoader = dynamic(() => import('./orchestration-loader').then((m) => m.OrchestrationLoader), { loading })
const TeamManagement = dynamic(() => import('./team-management').then((m) => m.TeamManagement), { loading })

export function WorkspaceClient() {
  const router = useRouter()
  const activeWorkspaceMode = useAppStore((s) => s.activeWorkspaceMode)
  const setActiveWorkspaceMode = useAppStore((s) => s.setActiveWorkspaceMode)
  const setProjectTitle = useAppStore((s) => s.setProjectTitle)
  const setProjectDescription = useAppStore((s) => s.setProjectDescription)
  const setProjectId = useProjectStore((s) => s.setProjectId)
  const reset = useProjectStore((s) => s.reset)
  const project = useProjectStore((s) => s.project)

  const searchParams = useSearchParams()
  const projectId = searchParams?.get('project')
  const view = searchParams?.get('view')

  useEffect(() => {
    if (!projectId) {
      router.replace('/my-projects')
      return
    }
    reset()
    setProjectId(projectId)
  }, [projectId, reset, setProjectId, router])

  // The open view lives in the URL (?view=...), so a reload, a shared link or
  // returning from GitHub sign-in lands on the same view.
  useEffect(() => {
    if (isWorkspaceMode(view) && view !== useAppStore.getState().activeWorkspaceMode) {
      setActiveWorkspaceMode(view)
    }
  }, [view, setActiveWorkspaceMode])

  const urlApplied = useRef(false)
  useEffect(() => {
    // On first load the URL wins: the store still holds its default here.
    if (!urlApplied.current) {
      urlApplied.current = true
      if (isWorkspaceMode(view)) return
    }
    if (!projectId || activeWorkspaceMode === view) return
    const params = new URLSearchParams(window.location.search)
    params.set('view', activeWorkspaceMode)
    router.replace(`/workspace?${params.toString()}`, { scroll: false })
    // Only the mode drives this; `view` catching up must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceMode, projectId])

  useOrchestrationStream(projectId || null)

  useEffect(() => {
    if (!project) return
    // Only write when the text changed: every store write re-renders the layout.
    const app = useAppStore.getState()
    const title = project.executive_summary?.project_title || project.title
    if (title && title !== app.projectTitle) setProjectTitle(title)
    const desc = project.executive_summary?.tagline || project.executive_summary?.overview || project.idea
    if (desc && desc !== app.projectDescription) setProjectDescription(desc)
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
      case 'github':
        return <GithubView />
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

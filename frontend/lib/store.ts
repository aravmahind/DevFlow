import { create } from 'zustand'

export type WorkspaceMode = 
  | 'track-live'
  | 'overview'
  | 'prerequisites'
  | 'requirements'
  | 'architecture'
  | 'backlog'
  | 'sprint'
  | 'risks'
  | 'cost'
  | 'team'
  | 'members'
  | 'tech-stack'
  | 'integrations'
  | 'milestones'
  | 'timeline'
  | 'documentation'
  | 'insights'
  | 'github'

export const WORKSPACE_MODES: readonly WorkspaceMode[] = [
  'track-live', 'overview', 'prerequisites', 'requirements', 'architecture', 'backlog', 'sprint',
  'risks', 'cost', 'team', 'members', 'tech-stack', 'integrations', 'milestones', 'timeline',
  'documentation', 'insights', 'github',
]

export const isWorkspaceMode = (value: string | null | undefined): value is WorkspaceMode =>
  !!value && (WORKSPACE_MODES as readonly string[]).includes(value)

export type OrchestrationNodeId =
  | 'idea'
  | 'requirements'
  | 'architecture'
  | 'tasks'
  | 'sprint'
  | 'risk'
  | 'cost'
  | 'execution'

export interface AppStore {
  // UI State
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  
  activeWorkspaceMode: WorkspaceMode
  setActiveWorkspaceMode: (mode: WorkspaceMode) => void
  
  aiPanelOpen: boolean
  setAiPanelOpen: (open: boolean) => void
  
  accountPanelOpen: boolean
  setAccountPanelOpen: (open: boolean) => void
  
  // Orchestration State
  activeOrchestrationNode: OrchestrationNodeId | null
  setActiveOrchestrationNode: (nodeId: OrchestrationNodeId | null) => void
  
  orchestrationRunning: boolean
  setOrchestrationRunning: (running: boolean) => void
  
  // Project Context
  projectTitle: string
  setProjectTitle: (title: string) => void
  
  projectDescription: string
  setProjectDescription: (description: string) => void
}

export const useAppStore = create<AppStore>((set) => ({
  // UI State
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  
  activeWorkspaceMode: 'overview',
  setActiveWorkspaceMode: (mode) => set({ activeWorkspaceMode: mode }),
  
  aiPanelOpen: false,
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  
  accountPanelOpen: false,
  setAccountPanelOpen: (open) => set({ accountPanelOpen: open }),
  
  // Orchestration State
  activeOrchestrationNode: null,
  setActiveOrchestrationNode: (nodeId) => set({ activeOrchestrationNode: nodeId }),
  
  orchestrationRunning: false,
  setOrchestrationRunning: (running) => set({ orchestrationRunning: running }),
  
  // Project Context
  projectTitle: 'New Project',
  setProjectTitle: (title) => set({ projectTitle: title }),
  
  projectDescription: '',
  setProjectDescription: (description) => set({ projectDescription: description }),
}))

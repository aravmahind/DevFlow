// Client for the PlanForge backend. The frontend talks ONLY to the backend
// (never directly to ai-services). The browser always reaches the backend on
// the host-published port, regardless of where the frontend itself runs.
import type { ProjectDoc } from './project-types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '')

function requiredUrl(value: string | undefined, variableName: string): string {
  if (!value) throw new Error(`${variableName} must be set in the environment`)
  return value
}

const endpoint = {
  agents: () => `${apiBase()}/agents`,
  projects: () => `${apiBase()}/projects`,
  project: (projectId: string) => `${apiBase()}/projects/${projectId}`,
  projectAction: (id: string, action: string) => `${apiBase()}/projects/${id}/${action}`,
  projectTask: (id: string, taskIdx: number) => `${apiBase()}/projects/${id}/tasks/${taskIdx}`,
  projectInvites: (id: string) => `${apiBase()}/projects/${id}/invites`,
  projectInviteAction: (id: string, inviteId: string) => `${apiBase()}/projects/${id}/invites/${inviteId}`,
  projectMemberAction: (id: string, memberId: string) => `${apiBase()}/projects/${id}/members/${memberId}`,
  myRole: () => `${apiBase()}/users/me/role`,
  users: () => `${apiBase()}/users`,
  userSync: () => `${apiBase()}/users/sync`,
  workspaces: () => `${apiBase()}/workspaces`,
  workspaceInvites: (workspaceId: string) => `${apiBase()}/workspaces/${workspaceId}/invites`,
  acceptWorkspaceInvite: (token: string) => `${apiBase()}/workspaces/invites/${token}/accept`,
  acceptProjectInviteEndpoint: (inviteId: string) => `${apiBase()}/invites/${inviteId}/accept`,
}

let tokenProvider: (() => Promise<string | null>) | null = null

export function setAuthTokenProvider(provider: (() => Promise<string | null>) | null) {
  tokenProvider = provider
}

export async function getAuthToken(): Promise<string | null> {
  return tokenProvider?.() ?? null
}

async function authHeaders(json = false): Promise<HeadersInit> {
  const token = await getAuthToken()
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export function apiBase(): string {
  return requiredUrl(API_BASE_URL, 'NEXT_PUBLIC_API_URL')
}

export function wsBase(): string {
  return requiredUrl(WS_BASE_URL, 'NEXT_PUBLIC_WS_URL')
}

export function streamUrl(projectId: string, token: string): string {
  return `${wsBase()}/projects/${projectId}/stream?token=${encodeURIComponent(token)}`
}

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body?.detail || detail
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`)
  }
  return res.json()
}


export async function analyzeProject(
  idea: string,
  title?: string,
  managerInputs: Record<string, unknown> = {},
): Promise<{ project_id: string; status: string }> {
  const res = await fetch(`${endpoint.projects()}/analyze`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ idea, title, ...managerInputs }),
  })
  return jsonOrThrow(res)
}

export async function retryProject(
  projectId: string,
): Promise<{ project_id: string; status: string }> {
  const res = await fetch(endpoint.projectAction(projectId, 'retry'), {
    method: 'POST',
    headers: await authHeaders(true),
  })
  return jsonOrThrow(res)
}

export type MigrationSource = 'spec' | 'file' | 'repo' | 'tickets'

/**
 * Reconstruct a full PlanForge plan from an existing project's artifacts
 * (a pasted spec/PRD, an uploaded CSV/doc, a ticket list, or a repo URL).
 * The backend seeds the same 8-agent pipeline with this content.
 */
export async function migrateProject(payload: {
  source: MigrationSource
  content: string
  title?: string
}): Promise<{ project_id: string; status: string }> {
  const res = await fetch(`${endpoint.projects()}/migrate`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify(payload),
  })
  return jsonOrThrow(res)
}

/** Ask the project assistant a question grounded in the project's plan. */
export async function askAssistant(
  projectId: string,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<{ reply: string; edits?: {path:string;value:any}[]; project?: ProjectDoc }> {
  const res = await fetch(endpoint.projectAction(projectId, 'chat'), {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ message, history }),
  })
  return jsonOrThrow(res)
}

export async function editProjectContent(projectId:string,path:string,value:any,expectedRevision?:number):Promise<{project:ProjectDoc}>{
  const res=await fetch(endpoint.projectAction(projectId, 'content'),{method:'PATCH',headers:await authHeaders(true),body:JSON.stringify({path,value,expected_revision:expectedRevision})})
  return jsonOrThrow(res)
}
export async function undoProject(projectId:string):Promise<{project:ProjectDoc}>{
  const res=await fetch(endpoint.projectAction(projectId, 'undo'),{method:'POST',headers:await authHeaders(true)})
  return jsonOrThrow(res)
}
export async function projectHistory(projectId:string):Promise<{history:any[]}>{
  const res=await fetch(endpoint.projectAction(projectId, 'history'),{headers:await authHeaders()}); return jsonOrThrow(res)
}
export async function listWorkspaces(){const res=await fetch(endpoint.workspaces(),{headers:await authHeaders()});return jsonOrThrow(res)}
export async function createWorkspace(name:string){const res=await fetch(endpoint.workspaces(),{method:'POST',headers:await authHeaders(true),body:JSON.stringify({name})});return jsonOrThrow(res)}
export async function createWorkspaceInvite(id:string,role:'admin'|'editor'|'viewer'){const res=await fetch(endpoint.workspaceInvites(id),{method:'POST',headers:await authHeaders(true),body:JSON.stringify({role})});return jsonOrThrow(res)}
export async function acceptWorkspaceInvite(token:string){const res=await fetch(endpoint.acceptWorkspaceInvite(token),{method:'POST',headers:await authHeaders(true)});return jsonOrThrow(res)}

export async function getProject(projectId: string): Promise<ProjectDoc> {
  const res = await fetch(endpoint.project(projectId), {
    cache: 'no-store', headers: await authHeaders(),
  })
  return jsonOrThrow(res)
}

export async function listProjects(): Promise<{ projects: Partial<ProjectDoc>[] }> {
  const res = await fetch(endpoint.projects(), { cache: 'no-store', headers: await authHeaders() })
  return jsonOrThrow(res)
}

export async function getAgents(): Promise<{ agents: { id: string; name: string; role: string; node: string }[] }> {
  const res = await fetch(endpoint.agents(), { cache: 'no-store' })
  return jsonOrThrow(res)
}

export async function syncUser(payload: {
  clerk_id: string
  email: string
  first_name: string
  last_name: string
  image_url: string
}): Promise<any> {
  const res = await fetch(endpoint.userSync(), {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify(payload),
  })
  return jsonOrThrow(res)
}

export async function getUsers(): Promise<{ users: any[] }> {
  const res = await fetch(endpoint.users(), { cache: 'no-store', headers: await authHeaders() })
  return jsonOrThrow(res)
}

export async function updateBacklog(projectId: string, backlog: any): Promise<{ status: string }> {
  const res = await fetch(endpoint.projectAction(projectId, 'backlog'), {
    method: 'PUT',
    headers: await authHeaders(true),
    body: JSON.stringify({ backlog }),
  })
  return jsonOrThrow(res)
}

export async function getProjectMembers(projectId:string):Promise<{members:any[];role:'manager'|'developer'|'tester'|null}>{const res=await fetch(endpoint.projectAction(projectId, 'members'),{headers:await authHeaders()});return jsonOrThrow(res)}

export async function updateProjectTask(projectId:string,index:number,payload:{assignee_id?:string|null;status?:string;expected_revision?:number}){const res=await fetch(endpoint.projectTask(projectId, index),{method:'PATCH',headers:await authHeaders(true),body:JSON.stringify(payload)});return jsonOrThrow(res)}

export async function getProjectInvites(projectId:string):Promise<{invites:any[]}>{const res=await fetch(endpoint.projectInvites(projectId),{headers:await authHeaders()});return jsonOrThrow(res)}
export async function inviteProjectMember(projectId:string,email:string,role:string,specialization?:string){const res=await fetch(endpoint.projectAction(projectId,'members'),{method:'POST',headers:await authHeaders(true),body:JSON.stringify({email,role,specialization})});return jsonOrThrow(res)}
export async function updateProjectMemberRole(projectId:string,memberId:string,role:string,specialization?:string){const res=await fetch(endpoint.projectMemberAction(projectId,memberId),{method:'PUT',headers:await authHeaders(true),body:JSON.stringify({role,specialization})});return jsonOrThrow(res)}
export async function removeProjectMember(projectId:string,memberId:string){const res=await fetch(endpoint.projectMemberAction(projectId,memberId),{method:'DELETE',headers:await authHeaders()});return jsonOrThrow(res)}
export async function revokeProjectInvite(projectId:string,inviteId:string){const res=await fetch(endpoint.projectInviteAction(projectId,inviteId),{method:'DELETE',headers:await authHeaders()});return jsonOrThrow(res)}
export async function updateMyRole(role:string,specialization?:string){const res=await fetch(endpoint.myRole(),{method:'PUT',headers:await authHeaders(true),body:JSON.stringify({role,specialization})});return jsonOrThrow(res)}
export async function updateMySpecialization(specialization:string){const res=await fetch(endpoint.myRole(),{method:'PUT',headers:await authHeaders(true),body:JSON.stringify({role:'developer',specialization})});return jsonOrThrow(res)}
export async function acceptProjectInvite(inviteId:string):Promise<{status:string}>{const res=await fetch(endpoint.acceptProjectInviteEndpoint(inviteId),{method:'POST',headers:await authHeaders(true)});return jsonOrThrow(res)}

export async function approveProject(
  projectId: string,
  phase: string,
  approved: boolean,
  feedback: string = ''
): Promise<any> {
  const res = await fetch(endpoint.projectAction(projectId, 'approve'), {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ phase, approved, feedback }),
  })
  return jsonOrThrow(res)
}
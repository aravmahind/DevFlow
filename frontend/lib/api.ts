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

export interface ExtractedDocument {
  filename: string
  title: string
  content: string
  char_count: number
  word_count: number
  truncated?: boolean
  mime_type?: string
  file_size?: number
}

export async function extractDocumentText(file: File): Promise<ExtractedDocument> {
  const token = await getAuthToken()
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${endpoint.projects()}/extract-document`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
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

/** Start or resume the workflow from its last checkpoint (managers only). */
export async function runProject(projectId: string): Promise<{ project_id: string; status: string }> {
  const res = await fetch(endpoint.projectAction(projectId, 'run'), {
    method: 'POST',
    headers: await authHeaders(true),
  })
  return jsonOrThrow(res)
}

/** Stop the running workflow; finished sections are kept. */
export async function stopProject(projectId: string): Promise<{ project_id: string; status: string }> {
  const res = await fetch(endpoint.projectAction(projectId, 'stop'), {
    method: 'POST',
    headers: await authHeaders(true),
  })
  return jsonOrThrow(res)
}

/** Pause the running workflow; finished sections are kept and resume continues. */
export async function pauseProject(projectId: string): Promise<{ project_id: string; status: string }> {
  const res = await fetch(endpoint.projectAction(projectId, 'pause'), {
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

export type AssistantEdit = { op?: 'set' | 'add' | 'remove'; path: string; value?: unknown }

/** Ask the project assistant a question grounded in the project's plan. */
export async function askAssistant(
  projectId: string,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<{ reply: string; edits?: AssistantEdit[]; edit_error?: string | null; project?: ProjectDoc | null }> {
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
export interface TaskAssignment { task_index: number; title: string; assignee_id: string; assignee: string; reason: string }
/** Assign backlog tasks to members by skill fit and workload (managers only). */
export async function autoAssignTasks(projectId: string, overwrite = false): Promise<{ project: ProjectDoc; assignments: TaskAssignment[] }> {
  const res = await fetch(endpoint.projectAction(projectId, 'tasks/auto-assign'), {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ overwrite }),
  })
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

export async function deleteProject(projectId: string): Promise<{ status: string; deleted: boolean; project_id: string }> {
  const res = await fetch(endpoint.project(projectId), {
    method: 'DELETE',
    headers: await authHeaders(),
  })
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

// ---- GitHub repository tracker ----
export type GithubItemStatus = 'implemented' | 'in_progress' | 'not_started'
export interface GithubPerson { key: string; login: string | null; name: string; avatar_url: string | null; commits?: number }
export interface GithubPlanItem {
  key: string; kind: 'task' | 'requirement'; title: string; epic: string; category: string
  board_status?: string; status: GithubItemStatus; mismatch: string | null; verdict_reason?: string | null
  contributors: GithubPerson[]; last_activity: string | null
  commits: { sha: string; message: string; author: string | null; url: string | null; committed_at: string | null; completion: 'partial' | 'complete' }[]
}
export interface GithubContributor extends GithubPerson {
  commits: number; additions: number; deletions: number; has_line_stats: boolean; first_commit: string | null; last_commit: string | null
  categories: Record<string, number>; top_areas: string[]
  delivered: { key: string; title: string }[]; touched: { key: string; title: string }[]
}
export interface GithubOverview {
  linked: boolean
  role?: 'manager' | 'developer' | 'tester'
  link?: {
    owner: string; repo: string; full_name: string; html_url: string; default_branch: string
    sync_status: 'pending' | 'syncing' | 'ready' | 'failed'; sync_error: string | null
    last_synced_at: string | null; head_sha: string | null; created_at: string | null
    has_token: boolean; linked_by: string | null; poll_seconds: number
    auth: 'account' | 'token' | 'none'; account_login: string | null
    webhook: { url: string; auto_registered: boolean; secret: string | null }
  }
  repo?: {
    description: string | null; language: string | null; languages: Record<string, number>
    stars: number; forks: number; open_issues: number; topics: string[]; private: boolean
    pushed_at: string | null; created_at: string | null; file_count: number
  }
  report?: { stale?: boolean; summary?: string; tech_stack?: string[]; highlights?: string[]; gaps?: string[]; generated_at?: string }
  items?: GithubPlanItem[]
  epics?: { epic: string; total: number; implemented: number; in_progress: number; percent: number }[]
  progress?: { total: number; implemented: number; in_progress: number; not_started: number; percent: number }
  contributors?: GithubContributor[]
  stats?: { commits: number; analyzed: number; untracked_features: number; additions: number; deletions: number; categories: Record<string, number> }
}
export interface GithubCommit {
  sha: string; author_login: string | null; author_name: string | null; author_avatar: string | null
  committed_at: string | null; message: string; url: string | null; additions: number; deletions: number
  files: { path: string; status: string; additions: number; deletions: number }[]
  analysis: { summary?: string; category?: string; area?: string; items?: { key: string; completion: string }[]; source?: string }
}

export async function getGithub(projectId: string): Promise<GithubOverview> {
  const res = await fetch(endpoint.projectAction(projectId, 'github'), { headers: await authHeaders() })
  return jsonOrThrow(res)
}

export async function linkGithub(
  projectId: string,
  repoUrl: string,
  opts: { accessToken?: string; useAccount?: boolean } = {},
): Promise<GithubOverview> {
  const res = await fetch(endpoint.projectAction(projectId, 'github'), {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({
      repo_url: repoUrl,
      access_token: opts.accessToken || null,
      use_account: !!opts.useAccount,
    }),
  })
  return jsonOrThrow(res)
}

// ---- Connected GitHub account (OAuth) ----
export interface GithubAccount {
  login: string; name: string | null; avatar_url: string | null; scopes: string[]
  can_read_private: boolean; can_manage_webhooks: boolean; needs_reconnect: boolean
  connected_at: string | null
}
export interface GithubAccountStatus {
  configured: boolean; connected: boolean; account: GithubAccount | null; manage_access_url: string | null
}
export interface GithubRepoOption {
  full_name: string; owner: string; name: string; private: boolean; description: string | null
  default_branch: string | null; pushed_at: string | null; language: string | null; can_admin: boolean
  stars: number; html_url: string | null; updated_at: string | null
}

export async function getGithubAccount(): Promise<GithubAccountStatus> {
  const res = await fetch(`${apiBase()}/github/account`, { headers: await authHeaders() })
  return jsonOrThrow(res)
}

/** Sends the browser to GitHub; it comes back to /github/callback, then to `returnTo`. */
export async function connectGithubAccount(returnTo: string): Promise<void> {
  const res = await fetch(`${apiBase()}/github/oauth/start`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ return_to: returnTo }),
  })
  const { authorize_url } = await jsonOrThrow(res)
  window.location.assign(authorize_url)
}

export async function completeGithubConnect(code: string, state: string): Promise<{ account: GithubAccount; return_to: string }> {
  const res = await fetch(`${apiBase()}/github/oauth/callback`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ code, state }),
  })
  return jsonOrThrow(res)
}

export async function disconnectGithubAccount(): Promise<{ status: string; affected_links: number }> {
  const res = await fetch(`${apiBase()}/github/account`, { method: 'DELETE', headers: await authHeaders() })
  return jsonOrThrow(res)
}

export async function listGithubRepos(): Promise<{ repos: GithubRepoOption[] }> {
  const res = await fetch(`${apiBase()}/github/repos`, { headers: await authHeaders() })
  return jsonOrThrow(res)
}

export async function unlinkGithub(projectId: string): Promise<{ status: string }> {
  const res = await fetch(endpoint.projectAction(projectId, 'github'), { method: 'DELETE', headers: await authHeaders() })
  return jsonOrThrow(res)
}

export async function syncGithub(projectId: string, reanalyze = false): Promise<{ status: string }> {
  const res = await fetch(`${endpoint.projectAction(projectId, 'github/sync')}${reanalyze ? '?reanalyze=true' : ''}`, {
    method: 'POST',
    headers: await authHeaders(),
  })
  return jsonOrThrow(res)
}

export async function listGithubCommits(projectId: string, opts: { limit?: number; offset?: number; author?: string } = {}): Promise<{ commits: GithubCommit[] }> {
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.offset) params.set('offset', String(opts.offset))
  if (opts.author) params.set('author', opts.author)
  const res = await fetch(`${endpoint.projectAction(projectId, 'github/commits')}?${params}`, { headers: await authHeaders() })
  return jsonOrThrow(res)
}

export async function askRepo(
  projectId: string,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<{ reply: string }> {
  const res = await fetch(endpoint.projectAction(projectId, 'github/chat'), {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ message, history }),
  })
  return jsonOrThrow(res)
}

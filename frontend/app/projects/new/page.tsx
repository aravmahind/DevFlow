'use client'

import React, { useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Loader2,
  Clock,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Plus,
  Eye,
} from 'lucide-react'
import { analyzeProject, extractDocumentText } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { WorkspaceAuthGate } from '@/components/auth/workspace-auth-gate'

const control =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

interface ContextDoc {
  id: string
  title: string
  filename?: string
  content: string
  source_type: 'spec' | 'file' | 'text'
  mime_type: string
  word_count: number
  char_count: number
  file_size?: number
  is_expanded?: boolean
}

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileBadge(filename?: string, mimeType?: string) {
  const ext = filename?.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf' || mimeType?.includes('pdf')) {
    return { label: 'PDF', badgeClass: 'bg-rose-50 text-rose-700 border-rose-200' }
  }
  if (ext === 'docx' || ext === 'doc' || mimeType?.includes('word') || mimeType?.includes('officedocument')) {
    return { label: 'DOCX', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' }
  }
  if (ext === 'md' || ext === 'markdown') {
    return { label: 'MARKDOWN', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200' }
  }
  if (ext === 'json') {
    return { label: 'JSON', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' }
  }
  if (ext === 'csv') {
    return { label: 'CSV', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  }
  return { label: 'SPEC', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' }
}

export default function NewProjectPage() {
  return (
    <WorkspaceAuthGate>
      <ProjectIntake />
    </WorkspaceAuthGate>
  )
}

function ProjectIntake() {
  const router = useRouter()
  const params = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [extracting, setExtracting] = useState<string | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    title: '',
    idea: params.get('idea') || '',
    timeline_weeks: 12,
    methodology: 'Agile',
    team_skills: 'Frontend, Backend, Product',
    priorities: 'MVP, Security, Reliability',
    constraints: '',
  })

  const [documents, setDocuments] = useState<ContextDoc[]>([])

  const set = (key: string, value: any) => setForm(v => ({ ...v, [key]: value }))

  const handleFiles = async (files: FileList | File[]) => {
    setDocError(null)
    const fileArray = Array.from(files)
    if (!fileArray.length) return

    for (const file of fileArray) {
      if (file.size > 20 * 1024 * 1024) {
        setDocError(`File "${file.name}" exceeds the 20MB limit.`)
        continue
      }
      setExtracting(file.name)
      try {
        let content = ''
        const rawTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
        let title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1)
        let word_count = 0
        let char_count = 0
        let mime_type = file.type || 'text/plain'

        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const isTextFile = ['txt', 'md', 'markdown', 'json', 'csv', 'yaml', 'yml'].includes(ext)

        if (isTextFile) {
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve((reader.result as string) || '')
            reader.onerror = () => reject(new Error('Failed to read file'))
            reader.readAsText(file)
          })
          content = content.trim()
          word_count = content.split(/\s+/).filter(Boolean).length
          char_count = content.length
        } else {
          const res = await extractDocumentText(file)
          content = res.content
          if (res.title) title = res.title
          word_count = res.word_count
          char_count = res.char_count
          mime_type = res.mime_type || mime_type
        }

        if (content.length < 12) {
          setDocError(`Document "${file.name}" contains too little readable text (minimum 12 characters required).`)
          continue
        }

        const newDoc: ContextDoc = {
          id: Math.random().toString(36).substring(2, 9),
          title,
          filename: file.name,
          content,
          source_type: 'spec',
          mime_type,
          word_count,
          char_count,
          file_size: file.size,
          is_expanded: false,
        }

        setDocuments(prev => [...prev, newDoc])

        setForm(prev => {
          if (!prev.title && title) {
            return { ...prev, title }
          }
          return prev
        })
      } catch (err: any) {
        setDocError(`Failed to process "${file.name}": ${err.message || 'Extraction error'}`)
      } finally {
        setExtracting(null)
      }
    }
  }

  const addManualDoc = () => {
    const newDoc: ContextDoc = {
      id: Math.random().toString(36).substring(2, 9),
      title: 'Project Requirements / PRD Note',
      content: '',
      source_type: 'spec',
      mime_type: 'text/plain',
      word_count: 0,
      char_count: 0,
      is_expanded: true,
    }
    setDocuments(prev => [...prev, newDoc])
  }

  const updateDoc = (id: string, patch: Partial<ContextDoc>) => {
    setDocuments(prev =>
      prev.map(doc => {
        if (doc.id !== id) return doc
        const updated = { ...doc, ...patch }
        if (patch.content !== undefined) {
          updated.word_count = patch.content.trim().split(/\s+/).filter(Boolean).length
          updated.char_count = patch.content.length
        }
        return updated
      })
    )
  }

  const removeDoc = (id: string) => {
    setDocuments(prev => prev.filter(doc => doc.id !== id))
  }

  const toggleExpandDoc = (id: string) => {
    setDocuments(prev =>
      prev.map(doc => (doc.id === id ? { ...doc, is_expanded: !doc.is_expanded } : doc))
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')

    const validDocs = documents.filter(doc => doc.content.trim().length >= 12)
    if (documents.length > 0 && validDocs.length === 0) {
      setError('Attached documents must contain at least 12 characters of readable content.')
      setBusy(false)
      return
    }

    try {
      const result = await analyzeProject(form.idea, form.title || undefined, {
        team_size: 4,
        timeline_weeks: Number(form.timeline_weeks) || null,
        methodology: form.methodology,
        team_skills: form.team_skills.split(',').map(x => x.trim()).filter(Boolean),
        priorities: form.priorities.split(',').map(x => x.trim()).filter(Boolean),
        constraints: form.constraints,
        source_documents: validDocs.map(doc => ({
          title: doc.title.trim() || doc.filename || 'Project Reference',
          content: doc.content.trim(),
          source_type: doc.source_type,
          mime_type: doc.mime_type,
          metadata: {
            authoritative: true,
            filename: doc.filename,
            word_count: doc.word_count,
            char_count: doc.char_count,
          },
        })),
      })

      useAppStore.getState().setActiveWorkspaceMode('track-live')
      router.push(`/workspace?project=${result.project_id}`)
    } catch (err: any) {
      setError(err.message || 'Failed to create project')
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <form
        onSubmit={submit}
        className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm"
      >
        <div className="mb-7">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Manager intake</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Plan a new project</h1>
          <p className="mt-2 text-sm text-slate-500">
            Give the AI organization real delivery constraints and reference context. You can edit all of these later.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Project name">
            <input
              required
              value={form.title}
              onChange={e => set('title', e.target.value)}
              className={control}
              placeholder="Customer Portal"
            />
          </Field>

          <Field label="Methodology">
            <select
              value={form.methodology}
              onChange={e => set('methodology', e.target.value)}
              className={control}
            >
              <option>Agile</option>
              <option>Scrum</option>
              <option>Kanban</option>
              <option>Waterfall</option>
              <option>Hybrid</option>
            </select>
          </Field>

          <Field wide label="What are you building?">
            <textarea
              required
              minLength={8}
              rows={5}
              value={form.idea}
              onChange={e => set('idea', e.target.value)}
              className={control}
              placeholder="Describe users, problem, key workflows, and desired outcome"
            />
          </Field>

          <Field label="Target timeline (weeks)" icon={Clock}>
            <input
              type="number"
              min="1"
              max="260"
              value={form.timeline_weeks}
              onChange={e => set('timeline_weeks', e.target.value)}
              className={control}
            />
          </Field>

          <Field label="Available skills">
            <input
              value={form.team_skills}
              onChange={e => set('team_skills', e.target.value)}
              className={control}
              placeholder="React, Python, QA, DevOps"
            />
          </Field>

          <Field wide label="Manager priorities">
            <input
              value={form.priorities}
              onChange={e => set('priorities', e.target.value)}
              className={control}
              placeholder="MVP, compliance, performance, security"
            />
          </Field>

          <Field wide label="Constraints, dependencies, or non-negotiables">
            <textarea
              rows={3}
              value={form.constraints}
              onChange={e => set('constraints', e.target.value)}
              className={control}
              placeholder="Launch date, existing stack, compliance requirements, external integrations…"
            />
          </Field>

          {/* Context & Knowledge Document Provision for Agent Pipeline */}
          <div className="sm:col-span-2 mt-2">
            <div className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50/50 via-white to-white p-5 sm:p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <h2 className="text-base font-bold text-slate-900">
                      Context & Reference Documents for Agent Pipeline
                    </h2>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Add PRDs, architecture specifications, API docs, or research notes. DevFlow&apos;s autonomous agents
                    chunk, vector-index, and cite these authoritative sources throughout requirement analysis, architecture,
                    risk review, and sprint planning.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addManualDoc}
                  className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                >
                  <Plus className="h-3.5 w-3.5 text-blue-600" />
                  Paste text note
                </button>
              </div>

              {/* Drag and Drop Upload Zone */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.txt,.md,.markdown,.json,.csv,.yaml,.yml"
                className="hidden"
                onChange={e => {
                  if (e.target.files) handleFiles(e.target.files)
                  e.target.value = ''
                }}
              />

              <div
                onDragOver={e => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(false)
                  if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                  dragOver
                    ? 'border-blue-500 bg-blue-50/80 scale-[0.99]'
                    : 'border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:bg-blue-50/30'
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100/80 text-blue-600 group-hover:scale-110 transition-transform">
                  <UploadCloud className="h-6 w-6" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-800">
                  <span className="text-blue-600 underline underline-offset-2">Click to upload a document</span> or drag and drop
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Supports PDF, Markdown (.md), Word (.docx), TXT, JSON, CSV (up to 20MB)
                </p>
              </div>

              {/* Extraction in progress loader */}
              {extracting && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-700">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span>Extracting text and structure from &ldquo;{extracting}&rdquo;…</span>
                </div>
              )}

              {/* Document upload error */}
              {docError && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{docError}</span>
                </div>
              )}

              {/* List of Attached Documents */}
              {documents.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600 px-0.5">
                    <span>
                      Attached Context ({documents.length} document{documents.length === 1 ? '' : 's'})
                    </span>
                    <span className="text-slate-400 font-normal">
                      {documents.reduce((acc, d) => acc + d.word_count, 0).toLocaleString()} total words ready for RAG
                    </span>
                  </div>

                  {documents.map(doc => {
                    const badge = getFileBadge(doc.filename, doc.mime_type)
                    return (
                      <div
                        key={doc.id}
                        className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition-all hover:border-slate-300"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.badgeClass}`}
                            >
                              {badge.label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <input
                                value={doc.title}
                                onChange={e => updateDoc(doc.id, { title: e.target.value })}
                                className="w-full font-semibold text-xs text-slate-800 bg-transparent outline-none focus:border-b focus:border-blue-500 py-0.5"
                                placeholder="Document title"
                              />
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                {doc.filename && <span>{doc.filename}</span>}
                                {doc.file_size && <span>• {formatBytes(doc.file_size)}</span>}
                                <span>• {doc.word_count.toLocaleString()} words</span>
                                <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Indexed for agents
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleExpandDoc(doc.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition"
                            >
                              {doc.is_expanded ? (
                                <>
                                  <ChevronUp className="h-3.5 w-3.5" /> Hide text
                                </>
                              ) : (
                                <>
                                  <Eye className="h-3.5 w-3.5" /> Preview / Edit
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeDoc(doc.id)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                              title="Remove document"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {/* Expandable Content Preview/Editor */}
                        {doc.is_expanded && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                              <span className="font-medium text-slate-700">
                                Context payload (agents will retrieve from this):
                              </span>
                              <span>{doc.char_count.toLocaleString()} characters</span>
                            </div>
                            <textarea
                              rows={6}
                              value={doc.content}
                              onChange={e => updateDoc(doc.id, { content: e.target.value })}
                              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 font-mono text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
                              placeholder="Paste or edit the document content here (minimum 12 characters)..."
                            />
                            {doc.content.trim().length < 12 && (
                              <p className="mt-1 text-[11px] text-rose-500 font-medium">
                                Minimum 12 characters required for agent retrieval indexing.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-600">
            {error}
          </p>
        )}

        <div className="mt-7 flex justify-end">
          <button
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {busy ? 'Starting AI organization…' : 'Create and orchestrate'}
          </button>
        </div>
      </form>
    </main>
  )
}

function Field({
  label,
  wide = false,
  icon: Icon,
  children,
}: {
  label: string
  wide?: boolean
  icon?: any
  children: React.ReactNode
}) {
  return (
    <label className={wide ? 'sm:col-span-2' : ''}>
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        {Icon && <Icon className="h-3.5 w-3.5 text-blue-600" />}
        {label}
      </span>
      {children}
    </label>
  )
}


'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, Loader2, Minus, Bot, Check, Undo2 } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from '@/lib/project-store'
import { askAssistant, undoProject, type AssistantEdit } from '@/lib/api'

type Msg = {
  role: 'user' | 'assistant'
  content: string
  edits?: AssistantEdit[]
  editError?: string | null
  undone?: boolean
}

function describeEdit(e: AssistantEdit): string {
  const where = e.path.replace(/^\//, '').replace(/\/(\d+)/g, ' #$1').replace(/\//g, ' › ').replace(/_/g, ' ')
  if (e.op === 'remove') return `Removed ${where}`
  if (e.op === 'add') return `Added to ${where.replace(/ › -$/, '')}`
  return `Updated ${where}`
}

const QUICK = [
  'Summarize this plan in 3 bullets',
  'What are the top risks and mitigations?',
  'Is the timeline realistic for the team?',
  'Where is most of the budget going?',
]

function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  const fmt = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="text-slate-900 font-semibold">{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    )
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        const isList = lines.every((l) => /^\s*[-*+•]\s+/.test(l) || l.trim() === '')
        if (isList) {
          return (
            <ul key={i} className="space-y-1 list-none pl-1">
              {lines.filter((l) => l.trim()).map((l, j) => (
                <li key={j} className="flex gap-2 items-start">
                  <span className="text-blue-600 mt-1 text-xs">•</span>
                  <span>{fmt(l.replace(/^\s*[-*+•]\s+/, ''))}</span>
                </li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{fmt(b)}</p>
      })}
    </div>
  )
}

export function AiAssistant() {
  const { aiPanelOpen, setAiPanelOpen } = useAppStore(useShallow((s) => ({ aiPanelOpen: s.aiPanelOpen, setAiPanelOpen: s.setAiPanelOpen })))
  const projectId = useProjectStore((s) => s.projectId)
  const project = useProjectStore((s) => s.project)
  const status = useProjectStore((s) => s.status)

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const ready = !!projectId && (status === 'complete' || !!project?.executive_summary)

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content:
            "Hi — I'm Flowmate. I can answer questions and edit this project's plan. Every change is saved with an undoable revision.",
        },
      ])
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  // Undo reverts the latest revision, so only the newest change set offers it.
  const lastEditIndex = messages.reduce((last, m, i) => (m.edits?.length && !m.undone ? i : last), -1)
  const undoEdits = async (index: number) => {
    if (!projectId) return
    try {
      const { project: reverted } = await undoProject(projectId)
      useProjectStore.getState().setProject(reverted)
      setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, undone: true } : msg)))
    } catch (err) {
      setMessages((m) => m.map((msg, i) => (i === index
        ? { ...msg, editError: `Undo failed: ${err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : err}` }
        : msg)))
    }
  }

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    if (!projectId) {
      setMessages((m) => [
        ...m,
        { role: 'user', content: q },
        { role: 'assistant', content: 'Open a project first — then I can answer questions grounded in its plan.' },
      ])
      setInput('')
      return
    }
    const history = messages.filter((m) => m.content)
    setMessages((m) => [...m, { role: 'user', content: q }])
    setInput('')
    setBusy(true)
    try {
      const { reply, edits, edit_error, project: changedProject } = await askAssistant(
        projectId, q, history.map(({ role, content }) => ({ role, content })),
      )
      if (changedProject) useProjectStore.getState().setProject(changedProject)
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: reply || 'No answer returned.', edits: edits || [], editError: edit_error },
      ])
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'I encountered an error reaching the model service. Please retry in a moment.' },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Floating launcher */}
      <AnimatePresence>
        {!aiPanelOpen && (
          <button
            onClick={() => setAiPanelOpen(true)}
            className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 pl-4 pr-5 py-2.5 text-white font-medium shadow-lg hover:shadow-xl transition-all cursor-pointer text-xs"
          >
            <Sparkles className="w-4 h-4" />
            Flowmate
          </button>
        )}
      </AnimatePresence>

      {/* Chat popup */}
      <AnimatePresence>
        {aiPanelOpen && (
          <motion.div
            className="fixed bottom-6 right-6 z-40 flex flex-col w-[min(92vw,400px)] h-[min(76vh,580px)] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Flowmate</div>
                  <div className="text-[10px] text-slate-500">
                    {ready ? 'Grounded in project plan' : 'Awaiting project plan…'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAiPanelOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-900 transition-colors"
                title="Minimize"
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-xs'
                        : 'bg-slate-100 text-slate-800 border border-slate-200/80 rounded-bl-xs'
                    }`}
                  >
                    {m.role === 'assistant' ? <Rich text={m.content} /> : m.content}
                    {!!m.edits?.length && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                        {m.edits.map((e, j) => (
                          <div key={j} className="flex items-start gap-1.5 text-[11px] text-emerald-700">
                            <Check className="w-3 h-3 mt-0.5 shrink-0" /> <span>{describeEdit(e)}</span>
                          </div>
                        ))}
                        {m.undone ? (
                          <p className="text-[11px] text-slate-500">Undone.</p>
                        ) : i === lastEditIndex && (
                          <button
                            onClick={() => undoEdits(i)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            <Undo2 className="w-3 h-3" /> Undo
                          </button>
                        )}
                      </div>
                    )}
                    {m.editError && (
                      <p className="mt-2 pt-2 border-t border-slate-200 text-[11px] text-amber-700">{m.editError}</p>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-slate-100 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    Analyzing project context…
                  </div>
                </div>
              )}
            </div>

            {/* Suggestions & Input */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-2">
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide py-1">
                {QUICK.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => send(q)}
                    className="flex-shrink-0 text-[11px] font-medium bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200 hover:border-blue-200 rounded-full px-2.5 py-1 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  send(input)
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask or tell Flowmate what to edit…"
                  className="flex-1 text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || busy}
                  className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

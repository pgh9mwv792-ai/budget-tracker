import { useEffect, useRef, useState } from 'react'
import { buildSystemPrompt, summarizeAppData, executeTool, callChat } from '../lib/chat'

const SUGGESTIONS = [
  'Add a $12 lunch expense',
  'How much have I spent this month?',
  'Set my Groceries budget to $400',
  'Log 1 serving of oatmeal for breakfast',
]

export default function ChatWidget({ context, actions, setActiveTab, openWith, onConsumeOpenWith }) {
  const [open, setOpen] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Display log: {role:'user'|'assistant', text} or {role:'action', items:[...]}
  const [messages, setMessages] = useState([])
  // Raw message history sent to the model (includes tool_use / tool_result blocks).
  const apiMessages = useRef([])
  // Live copies of created-during-this-turn items so a multi-step request (e.g.
  // "make a Travel category and budget it $200") can see what it just created.
  const live = useRef({ categories: [], goals: [], foods: [] })
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  // Lets other screens (e.g. the Dashboard quick-ask bar) hand a prompt to the
  // assistant: open the panel and send it, then clear the hand-off.
  useEffect(() => {
    if (!openWith) return
    setOpen(true)
    send(openWith)
    onConsumeOpenWith?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWith])

  async function send(text) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setError(null)
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }])

    // Seed live copies from the current app data for this turn.
    live.current = {
      categories: [...(context.categories || [])],
      goals: [...(context.goals || [])],
      foods: [...(context.foods || [])],
    }
    // Wrap the create actions so newly-created items become visible to later
    // tool calls within the same turn.
    const wrapped = {
      ...actions,
      addCategory: async (v) => {
        const c = await actions.addCategory(v)
        if (c) live.current.categories.push(c)
        return c
      },
      addGoal: async (v) => {
        const g = await actions.addGoal(v)
        if (g) live.current.goals.push(g)
        return g
      },
      addFood: async (v) => {
        const f = await actions.addFood(v)
        if (f) live.current.foods.push(f)
        return f
      },
    }
    const toolCtx = {
      categories: live.current.categories,
      goals: live.current.goals,
      foods: live.current.foods,
      memories: context.memories || [],
      actions: wrapped,
      setActiveTab,
    }

    let convo = [...apiMessages.current, { role: 'user', content: trimmed }]
    const system = buildSystemPrompt(summarizeAppData(context))
    setBusy(true)
    try {
      // Agentic loop: keep going while the model wants to use tools.
      for (let i = 0; i < 8; i++) {
        const resp = await callChat({ system, messages: convo })
        convo = [...convo, { role: 'assistant', content: resp.content }]

        const text = resp.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        if (text) setMessages((prev) => [...prev, { role: 'assistant', text }])

        const toolUses = resp.content.filter((b) => b.type === 'tool_use')
        if (resp.stop_reason === 'tool_use' && toolUses.length > 0) {
          const results = []
          const labels = []
          for (const tu of toolUses) {
            const result = await executeTool(tu.name, tu.input, toolCtx)
            labels.push(result)
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
          }
          setMessages((prev) => [...prev, { role: 'action', items: labels }])
          convo = [...convo, { role: 'user', content: results }]
          continue
        }
        break
      }
      apiMessages.current = convo
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="fixed bottom-5 right-5 z-20 h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg grid place-items-center text-2xl transition"
      >
        💬
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-20 w-[min(24rem,calc(100vw-2.5rem))] h-[min(32rem,calc(100vh-2.5rem))] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          Assistant
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMemory((v) => !v)}
            title="What the assistant remembers"
            aria-label="View saved memory"
            className={`text-lg leading-none ${
              showMemory ? 'opacity-100' : 'opacity-60 hover:opacity-100'
            } transition`}
          >
            🧠
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none"
          >
            ✕
          </button>
        </div>
      </div>

      {showMemory && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 max-h-48 overflow-y-auto">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Saved privately in your own database. Only you can see this. Delete anything you don't want kept.
          </p>
          {(context.memories || []).length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing remembered yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {(context.memories || []).map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <span>{m.content}</span>
                  <button
                    onClick={() => actions.deleteMemory(m.id)}
                    aria-label="Forget this"
                    className="shrink-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-slate-500 dark:text-slate-400 space-y-3">
            <p>Hi! I can answer questions about your money and food, and make changes for you. Try:</p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'action') {
            return (
              <div key={i} className="space-y-1">
                {m.items.map((it, j) => (
                  <div key={j} className="text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-1">
                    <span>✓</span>
                    <span>{it}</span>
                  </div>
                ))}
              </div>
            )
          }
          const mine = m.role === 'user'
          return (
            <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  mine
                    ? 'bg-emerald-600 text-white rounded-br-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          )
        })}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
              Thinking…
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask or tell me to do something…"
          disabled={busy}
          className="flex-1 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 font-medium transition disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

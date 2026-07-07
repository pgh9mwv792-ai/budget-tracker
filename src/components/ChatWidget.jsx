import { useEffect, useRef, useState } from 'react'
import { buildSystemPrompt, summarizeAppData, executeTool, callChat } from '../lib/chat'
import { fileToContentBlock } from '../lib/receipt'
import UpgradeGate from './UpgradeGate'

const SUGGESTIONS = [
  'Add a $12 lunch expense',
  'How much have I spent this month?',
  'Set my Groceries budget to $400',
  'Log 1 serving of oatmeal for breakfast',
]

// Tools whose result is plumbing for the model, not something worth showing the
// user as a green "✓ ..." line (e.g. the verbose food-database search dump).
const SILENT_TOOLS = new Set(['search_food_database', 'search_transactions'])

// True when the assistant is asking which meal to log to, so we can offer
// Breakfast/Lunch/Dinner/Snack buttons instead of making the user type.
const MEAL_CHOICES = ['Breakfast', 'Lunch', 'Dinner', 'Snack']
function isMealQuestion(text) {
  if (!text) return false
  const t = text.toLowerCase()
  return t.trimEnd().endsWith('?') && /\bmeal\b/.test(t) && /breakfast|lunch|dinner|snack/.test(t)
}

// True when the assistant's latest message looks like a "shall I log these?"
// confirmation, so we can offer Yes / No buttons instead of making the user type.
function isLogConfirmation(text) {
  if (!text) return false
  const t = text.toLowerCase()
  return t.trimEnd().endsWith('?') && /\blog\b|\blogging\b/.test(t)
}

// A real user prompt turn in the raw model history — as opposed to a tool_result
// turn, which is also role 'user' but carries tool_result blocks. Used to rewind
// history when a message is edited. Handles string content (plain text) and
// array content (a message with attached image blocks).
function isUserPromptTurn(m) {
  if (m.role !== 'user') return false
  if (typeof m.content === 'string') return true
  return Array.isArray(m.content) && !m.content.some((b) => b?.type === 'tool_result')
}

export default function ChatWidget({ plan, context, actions, setActiveTab, openWith, onConsumeOpenWith }) {
  const isPro = plan === 'pro'
  const [open, setOpen] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Photos the user has attached but not yet sent: {file, url}. url is an object
  // URL used for the preview thumbnail (and kept alive once handed to a message).
  const [attachments, setAttachments] = useState([])
  const fileRef = useRef(null)
  // When set, we're editing the user message at this index in `messages`.
  const [editingIndex, setEditingIndex] = useState(null)
  const [editText, setEditText] = useState('')
  // Display log: {role:'user'|'assistant', text}, {role:'action', items:[...]},
  // or {role:'note', text} for small system notices like "Stopped".
  const [messages, setMessages] = useState([])
  // Raw message history sent to the model (includes tool_use / tool_result blocks).
  const apiMessages = useRef([])
  // Aborts the in-flight request when the user hits Stop.
  const abortRef = useRef(null)
  // Set by Stop so the agentic loop bails out between steps and we suppress the
  // resulting "aborted" error.
  const stoppedRef = useRef(false)
  // Live copies of created-during-this-turn items so a multi-step request (e.g.
  // "make a Travel category and budget it $200") can see what it just created.
  const live = useRef({ categories: [], goals: [], foods: [] })
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  // Lets other screens (e.g. the Dashboard quick-ask bar) hand a prompt to the
  // assistant: open the panel and send it, then clear the hand-off.
  useEffect(() => {
    if (!openWith) return
    setOpen(true)
    // Free users get the upgrade card instead of an answer (the assistant is a
    // Pro feature); only actually send the prompt for Pro users.
    if (isPro) send(openWith)
    onConsumeOpenWith?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWith])

  // Press Esc while the assistant is working to stop it. Only active when a
  // request is in flight, so it never clashes with Esc-to-cancel in the editor.
  useEffect(() => {
    if (!busy) return
    const onKey = (e) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  // Cancels the current request. We only flip a flag + abort the fetch here; the
  // running send() loop notices the flag, rolls the model history back to the
  // last valid point, and stops.
  function stop() {
    if (!busy) return
    stoppedRef.current = true
    abortRef.current?.abort()
    setMessages((prev) => [...prev, { role: 'note', text: 'Stopped. You can edit your message and send it again.' }])
    setBusy(false)
  }

  // Edit a previously-sent question: rewind both the on-screen log and the
  // model's history to just before that message, then resend the new text —
  // mirroring the "edit your message" flow in Claude.
  function startEdit(i) {
    if (busy) return
    setEditingIndex(i)
    setEditText(messages[i].text)
  }

  function cancelEdit() {
    setEditingIndex(null)
    setEditText('')
  }

  async function submitEdit(i) {
    const newText = editText.trim()
    if (!newText) return
    // Which user turn is this among the visible user bubbles?
    const userTurnIndex =
      messages.slice(0, i + 1).filter((m) => m.role === 'user').length - 1
    // Find that same turn in the raw model history (user turns there are the
    // string-content entries; tool results are also role 'user' but arrays) and
    // drop it and everything after it.
    let count = 0
    let cut = apiMessages.current.length
    for (let j = 0; j < apiMessages.current.length; j++) {
      if (isUserPromptTurn(apiMessages.current[j])) {
        if (count === userTurnIndex) {
          cut = j
          break
        }
        count++
      }
    }
    apiMessages.current = apiMessages.current.slice(0, cut)
    setMessages((prev) => prev.slice(0, i))
    setEditingIndex(null)
    setEditText('')
    await send(newText)
  }

  // Pick photos to attach to the next message (receipts, etc.). We keep only
  // images — the chat vision path reads them; PDFs go through the receipt scanner.
  function addFiles(fileList) {
    const picked = Array.from(fileList ?? []).filter((f) => f.type.startsWith('image/'))
    if (!picked.length) return
    setAttachments((cur) => [...cur, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))])
  }

  function removeAttachment(idx) {
    setAttachments((cur) => {
      const next = [...cur]
      const [gone] = next.splice(idx, 1)
      if (gone) URL.revokeObjectURL(gone.url)
      return next
    })
  }

  async function send(text, files = attachments) {
    const trimmed = (text ?? '').trim()
    if ((!trimmed && files.length === 0) || busy) return
    if (!isPro) {
      setOpen(true)
      return
    }
    setError(null)
    setInput('')

    // Build the content sent to the model: a plain string when there's no photo,
    // or an array of image blocks + a text block when there is. Converting a
    // photo can throw on an unreadable file, so bail cleanly if it does.
    let content = trimmed
    const attachUrls = files.map((a) => a.url)
    if (files.length) {
      try {
        const blocks = await Promise.all(files.map((a) => fileToContentBlock(a.file)))
        content = [...blocks, { type: 'text', text: trimmed || 'Here is a photo — please take a look and help.' }]
      } catch (e) {
        setError(e.message)
        return
      }
      // Handed off to the message below; keep the object URLs alive for the
      // thumbnail rather than revoking them here.
      setAttachments([])
    }

    setMessages((prev) => [...prev, { role: 'user', text: trimmed, attachments: attachUrls }])
    stoppedRef.current = false
    const controller = new AbortController()
    abortRef.current = controller

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
      // Read-only for search_transactions (cross-referencing a bought-out meal
      // against the user's real charges); the food-search dump is silent too.
      transactions: context.transactions || [],
      memories: context.memories || [],
      actions: wrapped,
      setActiveTab,
    }

    let convo = [...apiMessages.current, { role: 'user', content }]
    // The last point that's valid to persist — one that ends on a completed
    // assistant turn or a tool_result, never on a tool_use still awaiting its
    // result or an unanswered question. If Stop interrupts, we roll back here.
    // Starts at the pre-send history so a Stop before any answer leaves history
    // clean (no dangling question).
    let safeConvo = apiMessages.current
    const system = buildSystemPrompt(summarizeAppData(context))
    setBusy(true)
    try {
      // Agentic loop: keep going while the model wants to use tools.
      for (let i = 0; i < 8; i++) {
        const resp = await callChat({ system, messages: convo, signal: controller.signal })
        if (stoppedRef.current) return
        convo = [...convo, { role: 'assistant', content: resp.content }]

        const text = resp.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()

        const toolUses = resp.content.filter((b) => b.type === 'tool_use')
        const isToolTurn = resp.stop_reason === 'tool_use' && toolUses.length > 0
        // A server-side web search can pause a long-running turn. Anthropic runs
        // the search itself, so there's nothing to execute here — we just send
        // the (unchanged) assistant content back on the next loop to resume.
        const isPauseTurn = resp.stop_reason === 'pause_turn'
        // Only surface the model's final message, not the "let me look that
        // up…" narration it emits alongside a tool call or mid-search pause —
        // that's what made it send two bubbles per request.
        if (text && !isToolTurn && !isPauseTurn)
          setMessages((prev) => [...prev, { role: 'assistant', text }])

        if (isToolTurn) {
          const results = []
          const labels = []
          for (const tu of toolUses) {
            if (stoppedRef.current) return
            const result = await executeTool(tu.name, tu.input, toolCtx)
            // The model still gets every result; we just don't clutter the chat
            // with noisy ones (the raw food-search dump) or scary raw errors —
            // the assistant explains a failure in plain language on its next turn.
            if (!SILENT_TOOLS.has(tu.name) && !result.startsWith('Error running')) labels.push(result)
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
          }
          if (stoppedRef.current) return
          if (labels.length) setMessages((prev) => [...prev, { role: 'action', items: labels }])
          convo = [...convo, { role: 'user', content: results }]
          safeConvo = convo
          continue
        }
        if (isPauseTurn) {
          // Loop again to let Anthropic finish the search. Don't advance
          // safeConvo: this assistant turn ends on a server tool_use still
          // awaiting its result, so a Stop here rewinds to the last clean point.
          // convo already carries resp.content unchanged (encrypted_content and
          // all), which is exactly what the resume request needs to send back.
          continue
        }
        safeConvo = convo
        break
      }
      apiMessages.current = safeConvo
    } catch (e) {
      // A user-initiated Stop rejects the fetch; that's expected, not an error.
      if (!stoppedRef.current) setError(e.message)
    } finally {
      apiMessages.current = safeConvo
      abortRef.current = null
      if (!stoppedRef.current) setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="fixed right-4 md:right-5 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-5 z-30 h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg grid place-items-center text-2xl transition"
      >
        💬
      </button>
    )
  }

  // Free users see the upgrade card in place of the chat UI. The assistant is a
  // Pro feature, and the backend enforces this too — this is just the front door.
  if (!isPro) {
    return (
      <div className="fixed z-50 flex flex-col bg-white dark:bg-slate-900 shadow-2xl inset-0 w-full h-full md:inset-auto md:bottom-5 md:right-5 md:w-[min(24rem,calc(100vw-2.5rem))] md:h-auto md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700">
        <div className="flex items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:pt-3 border-b border-slate-200 dark:border-slate-800">
          <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            Assistant
          </span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          <UpgradeGate
            plan={plan}
            title="The AI assistant is a Pro feature"
            blurb="Upgrade to ask questions about your money and food and have the assistant make changes for you."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed z-50 flex flex-col bg-white dark:bg-slate-900 shadow-2xl inset-0 w-full h-full md:inset-auto md:bottom-5 md:right-5 md:w-[min(24rem,calc(100vw-2.5rem))] md:h-[min(32rem,calc(100vh-2.5rem))] md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700">
      <div className="flex items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:pt-3 border-b border-slate-200 dark:border-slate-800">
        <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          Assistant
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMemory((v) => !v)}
            title="What the assistant remembers"
            aria-label="View saved memory"
            className={`h-11 w-11 grid place-items-center text-lg leading-none ${
              showMemory ? 'opacity-100' : 'opacity-60 hover:opacity-100'
            } transition`}
          >
            🧠
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="h-11 w-11 grid place-items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none"
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
          if (m.role === 'note') {
            return (
              <div key={i} className="text-center text-xs text-slate-400 dark:text-slate-500 italic">
                {m.text}
              </div>
            )
          }
          const mine = m.role === 'user'

          // Inline editor for a previously-sent question.
          if (mine && editingIndex === i) {
            return (
              <div key={i} className="flex justify-end">
                <div className="w-[90%]">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        submitEdit(i)
                      }
                      if (e.key === 'Escape') cancelEdit()
                    }}
                    rows={2}
                    autoFocus
                    className="w-full rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                  />
                  <div className="flex justify-end gap-2 mt-1">
                    <button
                      onClick={cancelEdit}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => submitEdit(i)}
                      disabled={!editText.trim()}
                      className="text-xs rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 font-medium disabled:opacity-50"
                    >
                      Save &amp; resend
                    </button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div key={i} className={`group flex items-end gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
              {mine && !busy && editingIndex === null && (
                <button
                  onClick={() => startEdit(i)}
                  title="Edit and resend"
                  aria-label="Edit this message"
                  className="opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs shrink-0 mb-1"
                >
                  ✎
                </button>
              )}
              <div className={`max-w-[85%] flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                {m.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-end">
                    {m.attachments.map((url, k) => (
                      <img
                        key={k}
                        src={url}
                        alt="attachment"
                        className="h-24 w-24 object-cover rounded-lg border border-emerald-300/60 dark:border-emerald-700/60"
                      />
                    ))}
                  </div>
                )}
                {m.text && (
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      mine
                        ? 'bg-emerald-600 text-white rounded-br-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-sm'
                    }`}
                  >
                    {m.text}
                  </div>
                )}
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

      {!busy &&
        editingIndex === null &&
        !input.trim() &&
        messages.length > 0 &&
        messages[messages.length - 1].role === 'assistant' &&
        (() => {
          const last = messages[messages.length - 1].text
          if (isMealQuestion(last)) {
            return (
              <div className="px-3 pt-2 grid grid-cols-2 gap-2">
                {MEAL_CHOICES.map((meal) => (
                  <button
                    key={meal}
                    onClick={() => send(meal.toLowerCase())}
                    className="rounded-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm py-2 font-medium transition"
                  >
                    {meal}
                  </button>
                ))}
              </div>
            )
          }
          if (isLogConfirmation(last)) {
            return (
              <div className="px-3 pt-2 flex gap-2">
                <button
                  onClick={() => send('yes')}
                  className="flex-1 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2 font-medium transition"
                >
                  Yes, log it
                </button>
                <button
                  onClick={() => inputRef.current?.focus()}
                  className="flex-1 rounded-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm py-2 font-medium transition"
                >
                  No, make changes
                </button>
              </div>
            )
          }
          return null
        })()}

      {attachments.length > 0 && editingIndex === null && (
        <div className="px-3 pt-2 flex flex-wrap gap-2">
          {attachments.map((a, idx) => (
            <div key={idx} className="relative">
              <img
                src={a.url}
                alt="pending attachment"
                className="h-16 w-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
              />
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                aria-label="Remove attachment"
                className="absolute -top-1.5 -right-1.5 h-5 w-5 grid place-items-center rounded-full bg-slate-700 hover:bg-slate-600 text-white text-[10px] leading-none"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3 border-t border-slate-200 dark:border-slate-800 flex gap-2"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Attach a photo"
          aria-label="Attach a photo"
          className="shrink-0 h-11 w-11 grid place-items-center rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-50 transition"
        >
          📎
        </button>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask, do something, or attach a receipt…"
          disabled={busy}
          className="flex-1 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            title="Stop (Esc)"
            aria-label="Stop generating"
            className="rounded-full bg-slate-700 hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-500 text-white text-sm px-4 font-medium transition grid place-items-center"
          >
            <span className="inline-block w-3 h-3 rounded-[3px] bg-white" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() && attachments.length === 0}
            className="rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 font-medium transition disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
    </div>
  )
}

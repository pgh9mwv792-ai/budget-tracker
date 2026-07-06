import { useEffect, useRef, useState, useCallback } from 'react'

// A shareable 1080×1080 "moment" card, hand-drawn on a <canvas> so we control
// the layout end-to-end (zero new dependencies) and export a crisp PNG.
//
// PRIVACY (hard rule): a card may contain ONLY the headline stat, an optional
// first name, and the app's name/mark. Never balances, bank names, transaction
// details, or full names. Callers build the `cards` specs and are responsible
// for keeping their strings within that boundary.
//
// A card spec: { id, label, eyebrow, stat, caption }
//   label   — short tab label when there's more than one card
//   eyebrow — small line above the stat (e.g. "Cost per 100g protein")
//   stat    — the big headline (e.g. "$3.42" or "$5,000")
//   caption — small line below (e.g. "this month" or a goal name)

const SIZE = 1080
const APP_NAME = 'Budget Tracker'
const APP_URL = 'budget-tracker-rose-mu.vercel.app'

const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

// Wrap `text` into at most `maxLines` lines that each fit `maxWidth` at the
// given font. Returns the lines (last line ellipsised if it overflows).
function wrapText(ctx, text, font, maxWidth, maxLines) {
  ctx.font = font
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next
    } else {
      lines.push(line)
      line = word
      if (lines.length === maxLines - 1) break
    }
  }
  if (lines.length < maxLines) lines.push(line)
  // Ellipsise the final line if the remaining text still overflows.
  let last = lines[lines.length - 1] || ''
  if (ctx.measureText(last).width > maxWidth) {
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1)
    }
    lines[lines.length - 1] = `${last}…`
  }
  return lines
}

// Pick the largest font size (from `start` down to `min`) at which `text` fits
// on a single line within `maxWidth`.
function fitFontSize(ctx, text, maxWidth, start, min) {
  let size = start
  while (size > min) {
    ctx.font = `800 ${size}px ${SANS}`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 4
  }
  return size
}

function drawCard(canvas, spec, firstName) {
  const ctx = canvas.getContext('2d')
  const pad = 96
  const contentW = SIZE - pad * 2

  // Background: the app's dark palette (slate-950 → deep emerald).
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE)
  bg.addColorStop(0, '#020617')
  bg.addColorStop(1, '#052e2b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Subtle emerald glow, top-left, echoing the product's accent.
  const glow = ctx.createRadialGradient(pad, pad, 0, pad, pad, 640)
  glow.addColorStop(0, 'rgba(16,185,129,0.20)')
  glow.addColorStop(1, 'rgba(16,185,129,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Brand row: emerald dot + wordmark.
  ctx.beginPath()
  ctx.arc(pad + 12, pad + 14, 14, 0, Math.PI * 2)
  ctx.fillStyle = '#10b981'
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f1f5f9'
  ctx.font = `700 40px ${SANS}`
  ctx.fillText(APP_NAME, pad + 40, pad + 28)

  // Eyebrow (uppercase, spaced, emerald).
  let y = 468
  if (spec.eyebrow) {
    ctx.font = `600 34px ${SANS}`
    ctx.fillStyle = '#34d399'
    ctx.textAlign = 'left'
    const eyebrow = spec.eyebrow.toUpperCase()
    // Manual letter-spacing for older canvas engines.
    let x = pad
    for (const ch of eyebrow) {
      ctx.fillText(ch, x, y)
      x += ctx.measureText(ch).width + 4
    }
    y += 52
  }

  // Stat (the headline) — auto-fit to one line, huge and white.
  const statSize = fitFontSize(ctx, spec.stat, contentW, 220, 96)
  ctx.font = `800 ${statSize}px ${SANS}`
  ctx.fillStyle = '#f8fafc'
  ctx.textAlign = 'left'
  y += statSize
  ctx.fillText(spec.stat, pad, y)

  // Caption below the stat (may wrap to two lines).
  if (spec.caption) {
    y += 64
    const captionFont = `500 44px ${SANS}`
    const lines = wrapText(ctx, spec.caption, captionFont, contentW, 2)
    ctx.font = captionFont
    ctx.fillStyle = '#94a3b8'
    for (const line of lines) {
      ctx.fillText(line, pad, y)
      y += 58
    }
  }

  // Footer: optional first name + the app URL, pinned to the bottom.
  if (firstName) {
    ctx.font = `500 36px ${SANS}`
    ctx.fillStyle = '#cbd5e1'
    ctx.fillText(`— ${firstName}`, pad, SIZE - pad - 44)
  }
  ctx.font = `500 30px ${SANS}`
  ctx.fillStyle = '#64748b'
  ctx.fillText(APP_URL, pad, SIZE - pad + 4)
}

export default function ShareCard({ cards, firstName = '', onClose }) {
  const canvasRef = useRef(null)
  const [activeId, setActiveId] = useState(cards[0]?.id)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const active = cards.find((c) => c.id === activeId) || cards[0]

  useEffect(() => {
    if (canvasRef.current && active) drawCard(canvasRef.current, active, firstName.trim())
  }, [active, firstName])

  const filename = `budget-tracker-${active?.id || 'card'}.png`

  const toBlob = useCallback(
    () =>
      new Promise((resolve) => {
        canvasRef.current?.toBlob((blob) => resolve(blob), 'image/png')
      }),
    []
  )

  async function download() {
    const blob = await toBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function share() {
    setBusy(true)
    setNote(null)
    try {
      const blob = await toBlob()
      if (!blob) return
      const file = new File([blob], filename, { type: 'image/png' })
      // Prefer the native share sheet (mobile) with the image file attached.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: APP_NAME })
      } else {
        await download()
      }
    } catch (e) {
      // AbortError = user dismissed the share sheet; that's not an error.
      if (e?.name !== 'AbortError') {
        setNote('Could not open the share sheet — the image was downloaded instead.')
        await download()
      }
    } finally {
      setBusy(false)
    }
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share a card"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Share your moment</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {cards.length > 1 && (
          <div className="grid grid-flow-col auto-cols-fr gap-1 mb-4 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm">
            {cards.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`px-2 py-1.5 rounded-md transition ${
                  active?.id === c.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-medium'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
          <canvas ref={canvasRef} width={SIZE} height={SIZE} className="block w-full h-auto" />
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Only this stat, your first name, and the app name are on the card — never balances, banks, or transactions.
        </p>

        {note && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{note}</p>}

        <div className="mt-4 flex gap-2">
          <button
            onClick={download}
            className="flex-1 rounded-md bg-slate-900 dark:bg-emerald-600 text-white py-2 text-sm font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition"
          >
            Download PNG
          </button>
          {canShare && (
            <button
              onClick={share}
              disabled={busy}
              className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-100 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
            >
              {busy ? 'Sharing…' : 'Share'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

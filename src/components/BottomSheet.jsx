import { useEffect } from 'react'

// A mobile bottom sheet: a panel that slides up from the bottom of the screen
// over a dimmed backdrop, with an optional title + close button and a
// scrollable body. Respects the phone's home-indicator area via safe-area
// padding. Renders nothing when `open` is false. Intended for use below the md
// breakpoint; on desktop, callers render their inline UI instead.
export default function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    // Lock background scroll while the sheet is up.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
      />
      <div className="relative w-full max-h-[90vh] flex flex-col rounded-t-2xl bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-2xl animate-[sheet-up_180ms_ease-out]">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="mx-auto sm:mx-0 -mt-1 mb-1 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden absolute left-1/2 -translate-x-1/2 top-1.5" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-11 w-11 -mr-2 grid place-items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  )
}

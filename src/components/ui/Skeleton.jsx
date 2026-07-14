import { useDelayedFlag } from '../../lib/useDelayedFlag'

// Base skeleton block. Uses the `bg-border` design token, which sits slightly
// lighter than `bg-surface` (cards) in the dark Deep Navy theme — never a raw
// hex. `animate-pulse` is dropped under prefers-reduced-motion, leaving a
// static, shimmer-free block. Pass sizing/rounding via `className`.
export function Skeleton({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse motion-reduce:animate-none rounded-md bg-border ${className}`}
    />
  )
}

// Card-shaped skeleton wrapper matching the app's standard card chrome, so a
// skeleton and the real card it replaces have identical borders and radius.
export function SkeletonCard({ className = '', children }) {
  return (
    <div className={`bg-surface rounded-xl border border-border shadow-sm p-4 ${className}`}>
      {children}
    </div>
  )
}

// Renders children only after `delay` ms. Wrap a Suspense fallback with this so
// a fast chunk fetch doesn't flash a skeleton for a few frames.
export function Delayed({ delay = 200, children }) {
  const shown = useDelayedFlag(true, delay)
  return shown ? children : null
}

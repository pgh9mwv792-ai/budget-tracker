import { Skeleton, SkeletonCard } from './ui/Skeleton'

// Per-view skeletons. Each mirrors the real component's card chrome, spacing,
// border radius and item counts so data swaps in with no layout shift. Only the
// data regions are skeletoned; interactive chrome (nav, headers) is either kept
// as real text or approximated at the same size.

function range(n) {
  return Array.from({ length: n })
}

// One transaction feed row: matches FeedRow's `px-4 py-3 min-h-14` layout with a
// name + category chip on the left and an amount on the right.
export function TransactionRowSkeleton() {
  return (
    <div className="px-4 py-3 min-h-14 flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <Skeleton className="h-4 w-32 sm:w-44" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Food-money hero card */}
      <SkeletonCard className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </SkeletonCard>

      {/* Income / Expenses / Net stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {range(3).map((_, i) => (
          <SkeletonCard key={i}>
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-7 w-28" />
          </SkeletonCard>
        ))}
      </div>

      {/* Two chart cards (category pie + rolling income bar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {range(2).map((_, i) => (
          <SkeletonCard key={i}>
            <Skeleton className="h-4 w-48 mb-3" />
            <Skeleton className="h-[220px] w-full rounded-lg" />
          </SkeletonCard>
        ))}
      </div>
    </div>
  )
}

export function TransactionListSkeleton() {
  return (
    <div className="space-y-4">
      {/* Add-transaction button */}
      <Skeleton className="h-12 w-full rounded-xl" />

      {/* Search + filter control row */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-full sm:flex-1 sm:min-w-40 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Group-by lens toggle */}
      <Skeleton className="h-9 w-48 rounded-lg" />

      {/* One dated group of rows */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between px-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
          {range(5).map((_, i) => (
            <TransactionRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function BudgetManagerSkeleton() {
  return (
    <div className="space-y-4">
      {/* Total-budgeted summary card */}
      <SkeletonCard>
        <div className="flex items-baseline justify-between mb-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </SkeletonCard>

      {/* Per-category rows with progress bars */}
      <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
        {range(5).map((_, i) => (
          <div key={i} className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-40 rounded-md" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function CreditTabSkeleton() {
  return (
    <div className="space-y-6">
      {/* Static heading chrome */}
      <div>
        <h2 className="text-lg font-semibold text-text">Credit</h2>
        <Skeleton className="mt-2 h-4 w-full max-w-xl" />
        <Skeleton className="mt-1.5 h-4 w-2/3 max-w-md" />
      </div>

      {/* Score card: latest score + deltas + trend chart */}
      <SkeletonCard className="space-y-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-48 md:h-56 w-full rounded-lg" />
      </SkeletonCard>

      {/* Utilization panel: overall bar + per-card bars */}
      <SkeletonCard className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="space-y-3 border-t border-border pt-3">
          {range(2).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  )
}

export function MealTrackerSkeleton() {
  return (
    <div className="space-y-4">
      {/* Day header card: title + date nav + macro bars */}
      <SkeletonCard className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
        <div className="space-y-2.5">
          {range(4).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonCard>

      {/* Meal section cards, each with a header + a couple of logged foods */}
      {range(3).map((_, i) => (
        <div key={i} className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
          <div className="px-4 py-2 border-b border-border">
            <Skeleton className="h-4 w-28" />
          </div>
          {range(2).map((_, j) => (
            <div key={j} className="px-4 py-3 flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function GoalTrackerSkeleton() {
  return (
    <div className="space-y-4">
      {/* Add-goal form card */}
      <SkeletonCard>
        <div className="flex flex-col sm:flex-row gap-2">
          <Skeleton className="h-10 sm:h-8 flex-1 rounded-md" />
          <Skeleton className="h-10 sm:h-8 w-full sm:w-40 rounded-md" />
          <Skeleton className="h-11 sm:h-8 w-24 rounded-md" />
        </div>
      </SkeletonCard>

      {/* Goal cards grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        {range(4).map((_, i) => (
          <SkeletonCard key={i}>
            <div className="flex justify-between items-start">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="mt-3 h-2 w-full rounded-full" />
            <div className="mt-2 flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-10" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  )
}

export function CategoryManagerSkeleton() {
  return (
    <div className="space-y-6">
      {/* Static heading chrome */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text">Categories</h2>
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      {/* Add-category form card */}
      <SkeletonCard className="!py-4">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 flex-1 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </SkeletonCard>

      {/* Two category columns */}
      <div className="grid sm:grid-cols-2 gap-4">
        {range(2).map((_, col) => (
          <div key={col} className="bg-surface rounded-xl border border-border shadow-sm">
            <div className="px-4 py-2 border-b border-border">
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="divide-y divide-border">
              {range(4).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CalendarSkeleton() {
  return (
    <div className="space-y-6">
      {/* AI entry bar */}
      <Skeleton className="h-12 w-full rounded-xl" />

      {/* Next-7-days summary card */}
      <SkeletonCard className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </SkeletonCard>

      {/* Month grid */}
      <SkeletonCard>
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {range(35).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
      </SkeletonCard>
    </div>
  )
}

// Shown inline while a Plaid bank sync is running. Immediate (no anti-flash
// delay) since bank sync is always slow, and paired with a "Syncing your bank…"
// hint so the wait is explained.
export function BankSyncSkeleton() {
  return (
    <div className="w-full space-y-2">
      <p className="text-sm text-text-muted">Syncing your bank…</p>
      <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
        {range(3).map((_, i) => (
          <TransactionRowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

// Bank-connection rows for the Settings → Connected banks section while its RPC
// loads. Matches the real `px-3 py-2.5` list-row layout.
export function ConnectedBanksSkeleton() {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {range(2).map((_, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-20" />
        </li>
      ))}
    </ul>
  )
}

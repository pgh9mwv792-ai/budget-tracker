// Small inline stroke icons for the mobile bottom tab bar, in the same
// Feather-style convention the app already uses elsewhere (24×24, currentColor
// stroke). Kept inline rather than in public/icons.svg because that sprite only
// holds social/brand marks, none of which fit these nav destinations.
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export function DashboardIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} {...base}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  )
}

export function TransactionsIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} {...base}>
      <path d="M17 3l3 3-3 3" />
      <path d="M20 6H8" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M4 18h12" />
    </svg>
  )
}

export function MealsIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} {...base}>
      <path d="M6 3v7a2 2 0 0 0 4 0V3" />
      <path d="M8 3v18" />
      <path d="M17 3c-1.5 0-3 2-3 5s1 4 3 4v9" />
    </svg>
  )
}

export function BudgetsIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} {...base}>
      <path d="M21 12a9 9 0 1 1-9-9" />
      <path d="M21 12A9 9 0 0 0 12 3v9z" />
    </svg>
  )
}

export function MoreIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} {...base}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  )
}

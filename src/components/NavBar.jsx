import { useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import BottomSheet from './BottomSheet'
import {
  DashboardIcon,
  TransactionsIcon,
  CalendarIcon,
  MealsIcon,
  BudgetsIcon,
  MoreIcon,
} from './NavIcons'

const TABS = ['Dashboard', 'Transactions', 'Calendar', 'Budgets', 'Credit', 'Meals', 'Goals', 'Categories']

// The primary destinations on the mobile bottom bar. Everything else lives
// behind "More".
const BOTTOM_TABS = [
  { tab: 'Dashboard', Icon: DashboardIcon },
  { tab: 'Transactions', Icon: TransactionsIcon },
  { tab: 'Calendar', Icon: CalendarIcon },
  { tab: 'Meals', Icon: MealsIcon },
  { tab: 'Budgets', Icon: BudgetsIcon },
]
const MORE_TABS = ['Credit', 'Goals', 'Categories', 'Settings']

export default function NavBar({ activeTab, onTabChange, userEmail, userName, avatarUrl, onSignOut }) {
  const { theme, toggleTheme } = useTheme()
  const [moreOpen, setMoreOpen] = useState(false)
  const label = userName || userEmail
  const initial = (userName || userEmail || '?').trim()[0]?.toUpperCase() || '?'
  const moreActive = MORE_TABS.includes(activeTab)

  const Avatar = () =>
    avatarUrl ? (
      <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-border" />
    ) : (
      <span className="w-7 h-7 rounded-full bg-primary-tint text-interactive grid place-items-center text-xs font-semibold">
        {initial}
      </span>
    )

  return (
    <>
      <header className="sticky top-0 z-30 bg-nav/90 text-nav-text backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-nav-text flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-interactive" />
              Budget Tracker
            </span>
            {/* Desktop tab row — replaced by the bottom bar below md. */}
            <nav className="hidden md:flex gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => onTabChange(tab)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                    activeTab === tab
                      ? 'bg-surface text-text'
                      : 'text-nav-text hover:bg-nav-text/10'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-1 sm:gap-3 text-sm text-nav-text">
            <button
              onClick={toggleTheme}
              title="Toggle dark mode"
              aria-label="Toggle dark mode"
              className="w-11 h-11 md:w-8 md:h-8 grid place-items-center rounded-md hover:bg-nav-text/10 transition"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              onClick={() => onTabChange('Settings')}
              title="Account settings"
              className={`flex items-center gap-2 min-h-11 px-1 hover:text-nav-text transition ${
                activeTab === 'Settings' ? 'text-nav-text font-medium' : ''
              }`}
            >
              <Avatar />
              <span className="hidden sm:inline max-w-[12rem] truncate">{label}</span>
            </button>
            {/* Sign out lives in the top bar on desktop; on mobile it moves into
                the More sheet to keep the top bar to name + theme + avatar. */}
            <button
              onClick={onSignOut}
              className="hidden md:inline hover:text-nav-text"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-border pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <div className="flex">
          {BOTTOM_TABS.map(({ tab, Icon }) => {
            const active = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                aria-current={active ? 'page' : undefined}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 h-16 transition ${
                  active
                    ? 'text-interactive'
                    : 'text-text-muted'
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-[11px] font-medium">{tab}</span>
              </button>
            )
          })}
          <button
            onClick={() => setMoreOpen(true)}
            aria-current={moreActive ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 h-16 transition ${
              moreActive ? 'text-interactive' : 'text-text-muted'
            }`}
          >
            <MoreIcon className="w-6 h-6" />
            <span className="text-[11px] font-medium">More</span>
          </button>
        </div>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="space-y-1">
          {MORE_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => {
                onTabChange(tab)
                setMoreOpen(false)
              }}
              className={`w-full text-left rounded-lg px-3 min-h-12 flex items-center text-sm font-medium transition ${
                activeTab === tab
                  ? 'bg-primary-tint text-interactive'
                  : 'text-text hover:bg-primary-tint'
              }`}
            >
              {tab}
            </button>
          ))}
          <button
            onClick={() => {
              setMoreOpen(false)
              onSignOut()
            }}
            className="w-full text-left rounded-lg px-3 min-h-12 flex items-center text-sm font-medium text-danger hover:bg-danger/10 transition"
          >
            Sign out
          </button>
        </div>
      </BottomSheet>
    </>
  )
}

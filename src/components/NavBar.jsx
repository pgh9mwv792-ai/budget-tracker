import { useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import BottomSheet from './BottomSheet'
import {
  DashboardIcon,
  TransactionsIcon,
  MealsIcon,
  BudgetsIcon,
  MoreIcon,
} from './NavIcons'

const TABS = ['Dashboard', 'Transactions', 'Budgets', 'Credit', 'Meals', 'Goals', 'Categories']

// The five primary destinations on the mobile bottom bar. Everything else lives
// behind "More".
const BOTTOM_TABS = [
  { tab: 'Dashboard', Icon: DashboardIcon },
  { tab: 'Transactions', Icon: TransactionsIcon },
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
      <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-slate-200 dark:border-slate-700" />
    ) : (
      <span className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 grid place-items-center text-xs font-semibold">
        {initial}
      </span>
    )

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
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
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-1 sm:gap-3 text-sm text-slate-500 dark:text-slate-400">
            <button
              onClick={toggleTheme}
              title="Toggle dark mode"
              aria-label="Toggle dark mode"
              className="w-11 h-11 md:w-8 md:h-8 grid place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              onClick={() => onTabChange('Settings')}
              title="Account settings"
              className={`flex items-center gap-2 min-h-11 px-1 hover:text-slate-900 dark:hover:text-slate-100 transition ${
                activeTab === 'Settings' ? 'text-slate-900 dark:text-slate-100 font-medium' : ''
              }`}
            >
              <Avatar />
              <span className="hidden sm:inline max-w-[12rem] truncate">{label}</span>
            </button>
            {/* Sign out lives in the top bar on desktop; on mobile it moves into
                the More sheet to keep the top bar to name + theme + avatar. */}
            <button
              onClick={onSignOut}
              className="hidden md:inline hover:text-slate-900 dark:hover:text-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]"
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
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
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
              moreActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
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
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
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
            className="w-full text-left rounded-lg px-3 min-h-12 flex items-center text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
          >
            Sign out
          </button>
        </div>
      </BottomSheet>
    </>
  )
}

import { useTheme } from '../contexts/ThemeContext'

const TABS = ['Dashboard', 'Transactions', 'Budgets', 'Meals', 'Goals', 'Categories']

export default function NavBar({ activeTab, onTabChange, userEmail, userName, avatarUrl, onSignOut }) {
  const { theme, toggleTheme } = useTheme()
  const label = userName || userEmail
  const initial = (userName || userEmail || '?').trim()[0]?.toUpperCase() || '?'

  return (
    <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
            Budget Tracker
          </span>
          <nav className="flex gap-1">
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

        <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
          <button
            onClick={toggleTheme}
            title="Toggle dark mode"
            aria-label="Toggle dark mode"
            className="w-8 h-8 grid place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            onClick={() => onTabChange('Settings')}
            title="Account settings"
            className={`flex items-center gap-2 hover:text-slate-900 dark:hover:text-slate-100 transition ${
              activeTab === 'Settings' ? 'text-slate-900 dark:text-slate-100 font-medium' : ''
            }`}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-slate-200 dark:border-slate-700" />
            ) : (
              <span className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 grid place-items-center text-xs font-semibold">
                {initial}
              </span>
            )}
            <span className="hidden sm:inline max-w-[12rem] truncate">{label}</span>
          </button>
          <button onClick={onSignOut} className="hover:text-slate-900 dark:hover:text-slate-100">
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}

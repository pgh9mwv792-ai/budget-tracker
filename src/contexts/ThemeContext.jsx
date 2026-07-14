import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)

// Persisted preference: 'light' | 'dark' | 'system'. 'system' follows the OS
// setting live. Legacy stored values were only 'light' | 'dark'; those still
// load correctly. Must stay in sync with the no-flash script in index.html.
function getInitialMode() {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(getInitialMode)
  // The actually-applied theme ('light' | 'dark'), resolving 'system' to the OS.
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // Track the OS preference so 'system' mode updates live without a reload.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  // Apply the resolved theme to <html> and persist the chosen mode.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', mode)
  }, [theme, mode])

  const value = useMemo(
    () => ({
      // Resolved theme actually on screen.
      theme,
      // Chosen preference (may be 'system').
      mode,
      setMode: setModeState,
      // Kept for the NavBar's one-tap toggle: flip between light and dark,
      // leaving 'system' behind once the user makes an explicit choice.
      toggleTheme: () => setModeState(theme === 'dark' ? 'light' : 'dark'),
    }),
    [theme, mode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

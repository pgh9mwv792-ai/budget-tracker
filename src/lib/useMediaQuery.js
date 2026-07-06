import { useEffect, useState } from 'react'

// Subscribes to a CSS media query and re-renders when it changes. Used to swap
// desktop layouts for mobile ones below Tailwind's `md` breakpoint (768px).
export function useMediaQuery(query) {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  const [matches, setMatches] = useState(get)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

// "Mobile" throughout the app means below Tailwind's md breakpoint.
export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)')
}

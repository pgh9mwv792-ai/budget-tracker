import { useEffect, useState } from 'react'

// Returns true only once `active` has stayed true for `delay` ms. Used to avoid
// skeleton flash on fast loads: if the data arrives before the delay, the
// skeleton never mounts. Resets immediately when `active` goes false.
export function useDelayedFlag(active, delay = 200) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!active) {
      setShown(false)
      return
    }
    const id = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(id)
  }, [active, delay])

  return shown
}

import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  // True when the user is signed in but still owes a 2FA code this session
  // (their account has a verified authenticator, but they're only at aal1).
  const [needsMfa, setNeedsMfa] = useState(false)

  // Ask Supabase what authentication assurance level we're at. If the account
  // has 2FA enabled, currentLevel is 'aal1' right after password login and
  // nextLevel is 'aal2' until they pass the code challenge.
  const refreshAal = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) {
      setNeedsMfa(false)
      return
    }
    setNeedsMfa(data.currentLevel === 'aal1' && data.nextLevel === 'aal2')
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await refreshAal()
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      if (newSession) await refreshAal()
      else setNeedsMfa(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [refreshAal])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    needsMfa,
    refreshAal,
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

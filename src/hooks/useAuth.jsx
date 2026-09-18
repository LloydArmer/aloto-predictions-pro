import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(uid) {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
      setProfile(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const signIn   = (e,p)   => supabase.auth.signInWithPassword({ email:e, password:p }).then(({data,error}) => { if(error) throw error; return data })
  const signUp   = (e,p,n) => supabase.auth.signUp({ email:e, password:p, options:{data:{display_name:n}} }).then(({data,error}) => { if(error) throw error; return data })
  const signOut  = ()      => supabase.auth.signOut().then(({error}) => { if(error) throw error })

  const isAdmin  = profile?.role === 'admin'

  // Kept only so the components that now read it do not crash.
  //
  // The per-competition admin check that used to compute this has been REMOVED.
  // It queried participants inside the auth flow and something about that query
  // never came back on a phone, which left the whole app behind its loading
  // spinner — an entire league locked out because of a check that decides
  // whether one nav item appears.
  //
  // Anything that widens who counts as an admin has to be worked out somewhere
  // that cannot take the app down with it.
  const isSiteAdmin = isAdmin
  const runsACompetition = isAdmin

  return (
    <AuthCtx.Provider value={{
      user, profile, loading,
      isAdmin, isSiteAdmin, runsACompetition,
      signIn, signUp, signOut, fetchProfile,
    }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}

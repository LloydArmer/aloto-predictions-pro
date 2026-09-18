import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Whether this person administers at least one competition. Held separately
  // from the profile because it lives in participants, not profiles.
  const [runsACompetition, setRunsACompetition] = useState(false)

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

      // Does this person run a competition of their own?
      //
      // participants.role has always recorded who administers what, and
      // createCompetition already writes 'admin' for whoever created it. Only
      // this check was missing, so the answer was never asked for.
      const { count } = await supabase
        .from('participants')
        .select('competition_id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('role', 'admin')

      setRunsACompetition((count ?? 0) > 0)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const signIn   = (e,p)   => supabase.auth.signInWithPassword({ email:e, password:p }).then(({data,error}) => { if(error) throw error; return data })
  const signUp   = (e,p,n) => supabase.auth.signUp({ email:e, password:p, options:{data:{display_name:n}} }).then(({data,error}) => { if(error) throw error; return data })
  const signOut  = ()      => supabase.auth.signOut().then(({error}) => { if(error) throw error })
  // Admin of SOMETHING, not admin of everything.
  //
  // This used to read profile.role alone — a single global flag. Since that
  // flag was already set on one account, the "claim admin access" offer (which
  // only appears when NO admin exists anywhere) could never show again, and no
  // new user could ever run a league. The app worked for one league and quietly
  // refused to work for a second.
  //
  // profile.role === 'admin' is kept for genuine site-wide administration.
  const isAdmin = profile?.role === 'admin' || runsACompetition

  // True site-wide admin, where that distinction matters.
  const isSiteAdmin = profile?.role === 'admin'

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

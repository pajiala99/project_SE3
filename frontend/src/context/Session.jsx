import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, tokenStore, setUnauthenticatedHandler } from '../api/client.js'

/**
 * Who is signed in, and what they may do.
 *
 * The backend hands out a JWT at /auth/login and /auth/register; every other
 * call carries it. On boot we exchange a stored token for the profile via
 * /auth/me, which also revalidates it — a token the server no longer accepts
 * logs the user out rather than leaving them on a broken screen.
 */
const SessionContext = createContext(null)

/**
 * /auth/login returns the user camelCased, /auth/me returns the database row
 * in snake_case. Normalise here so no screen has to know which call it came
 * from.
 */
function normalizeUser(u) {
  if (!u) return null
  return {
    id: u.user_id ?? u.userId,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone ?? null,
    address: u.address ?? null,
  }
}

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [booting, setBooting] = useState(true)

  const signOut = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setProfile(null)
  }, [])

  useEffect(() => { setUnauthenticatedHandler(() => { setUser(null); setProfile(null) }) }, [])

  useEffect(() => {
    if (!tokenStore.get()) { setBooting(false); return }
    let alive = true
    api.me()
      .then((r) => { if (alive) { setUser(normalizeUser(r.user)); setProfile(r.profile ?? null) } })
      .catch(() => { if (alive) signOut() })
      .finally(() => { if (alive) setBooting(false) })
    return () => { alive = false }
  }, [signOut])

  const signIn = useCallback(async (email, password) => {
    const r = await api.login(email, password)
    tokenStore.set(r.token)
    const me = await api.me()
    setUser(normalizeUser(me.user))
    setProfile(me.profile ?? null)
  }, [])

  const signUp = useCallback(async (payload) => {
    const r = await api.register(payload)
    tokenStore.set(r.token)
    setUser(normalizeUser(r.user))
    setProfile(r.profile ?? null)
  }, [])

  return (
    <SessionContext.Provider value={{ user, profile, booting, signIn, signUp, signOut, setProfile }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside a SessionProvider')
  return ctx
}

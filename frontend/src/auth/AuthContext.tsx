import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '@/api'
import type { User } from '@/lib/types'

interface AuthValue {
  user: User | null
  /** True until the first check of the existing session has finished. */
  loading: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => Promise<void>
  setUser: (u: User) => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api.getCurrentUser()
      .then((u) => alive && setUser(u))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false))
    // The server ended the session (expired, signed out elsewhere, deactivated).
    const onUnauthorized = () => {
      setUser(null)
      qc.clear()
    }
    window.addEventListener('buslead:unauthorized', onUnauthorized)
    return () => {
      alive = false
      window.removeEventListener('buslead:unauthorized', onUnauthorized)
    }
  }, [qc])

  const signIn = useCallback(async (email: string, password: string) => {
    const u = await api.login(email, password)
    setUser(u)
    return u
  }, [])

  const signOut = useCallback(async () => {
    await api.logout()
    setUser(null)
    qc.clear()
  }, [qc])

  const value = useMemo<AuthValue>(() => ({ user, loading, isAdmin: user?.role === 'admin', signIn, signOut, setUser }), [user, loading, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { SsoProviderInfo, User } from '../../../shared/src/index.js'
import { getMe, login as apiLogin, setToken } from '../lib/api'

interface AuthState {
  user: User | null
  authRequired: boolean
  localEnabled: boolean
  providers: SsoProviderInfo[]
  ssoError: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * After an SSO round-trip the backend redirects to `…/login#token=<token>`
 * (or `#error=<message>`). Pull either out of the fragment and clear it so the
 * token never lingers in the address bar or browser history.
 */
function consumeAuthHash(): { token: string | null; error: string | null } {
  if (!window.location.hash) return { token: null, error: null }
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get('token')
  const error = params.get('error')
  if (token || error) {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    )
  }
  return { token, error }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [localEnabled, setLocalEnabled] = useState(true)
  const [providers, setProviders] = useState<SsoProviderInfo[]>([])
  const [ssoError, setSsoError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await getMe()
      setUser(me.user)
      setAuthRequired(me.authRequired)
      setLocalEnabled(me.localEnabled)
      setProviders(me.providers)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const { token, error } = consumeAuthHash()
    if (token) setToken(token)
    if (error) setSsoError(error)
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiLogin({ email, password })
      setToken(result.token)
      setUser(result.user)
    },
    []
  )

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      authRequired,
      localEnabled,
      providers,
      ssoError,
      loading,
      login,
      logout,
      refresh,
    }),
    [
      user,
      authRequired,
      localEnabled,
      providers,
      ssoError,
      loading,
      login,
      logout,
      refresh,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

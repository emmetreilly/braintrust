import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { auth } from '../lib/api'
import type { User, Workspace } from '../types'

interface AuthState {
  user: User | null
  token: string | null
  workspace: Workspace | null
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<void>
  clearError: () => void
  setToken: (token: string) => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      workspace: null,
      isLoading: true,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          const { user, token, workspace } = await auth.login(email, password)
          localStorage.setItem('token', token)
          set({ user, token, workspace, isLoading: false })
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false })
          throw err
        }
      },

      signup: async (email: string, password: string, name: string) => {
        set({ isLoading: true, error: null })
        try {
          const { user, token, workspace } = await auth.signup(email, password, name)
          localStorage.setItem('token', token)
          set({ user, token, workspace, isLoading: false })
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false })
          throw err
        }
      },

      logout: () => {
        localStorage.removeItem('token')
        set({ user: null, token: null, workspace: null, isLoading: false })
      },

      checkAuth: async () => {
        // If we already have a user, don't re-check (prevents loop on signup/login)
        if (get().user) {
          set({ isLoading: false })
          return
        }

        const token = get().token || localStorage.getItem('token')
        if (!token) {
          set({ isLoading: false })
          return
        }

        try {
          const { user, workspace } = await auth.me()
          set({ user, token, workspace, isLoading: false })
        } catch {
          localStorage.removeItem('token')
          set({ user: null, token: null, workspace: null, isLoading: false })
        }
      },

      clearError: () => set({ error: null }),

      setToken: async (token: string) => {
        localStorage.setItem('token', token)
        set({ token, isLoading: true })
        try {
          const { user, workspace } = await auth.me()
          set({ user, workspace, isLoading: false })
        } catch {
          localStorage.removeItem('token')
          set({ user: null, token: null, workspace: null, isLoading: false })
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
)

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { auth } from '../lib/api'
import type { User } from '../types'

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: true,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          const { user, token } = await auth.login(email, password)
          localStorage.setItem('token', token)
          set({ user, token, isLoading: false })
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false })
          throw err
        }
      },

      signup: async (email: string, password: string, name: string) => {
        set({ isLoading: true, error: null })
        try {
          const { user, token } = await auth.signup(email, password, name)
          localStorage.setItem('token', token)
          set({ user, token, isLoading: false })
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false })
          throw err
        }
      },

      logout: () => {
        localStorage.removeItem('token')
        set({ user: null, token: null, isLoading: false })
      },

      checkAuth: async () => {
        const token = get().token || localStorage.getItem('token')
        if (!token) {
          set({ isLoading: false })
          return
        }

        try {
          const { user } = await auth.me()
          set({ user, token, isLoading: false })
        } catch {
          localStorage.removeItem('token')
          set({ user: null, token: null, isLoading: false })
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
)

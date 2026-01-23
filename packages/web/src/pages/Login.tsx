import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'

type Step = 'welcome' | 'form'

// For OAuth, we need the full URL. In dev, use localhost worker; in prod, use deployed worker.
const API_URL = import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost' ? '' : 'https://brain-trust-worker.e-caa.workers.dev')

export default function Login() {
  const [step, setStep] = useState<Step>('welcome')
  const [isLogin, setIsLogin] = useState(false)

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  const { login, signup, setToken, error, clearError } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Handle OAuth callback
  useEffect(() => {
    const token = searchParams.get('token')
    const oauthError = searchParams.get('error')

    if (token) {
      // Got token from OAuth - store it and navigate
      setToken(token)
      navigate('/', { replace: true })
    } else if (oauthError) {
      // OAuth failed
      const errorMessages: Record<string, string> = {
        no_code: 'OAuth authorization failed',
        token_failed: 'Failed to authenticate with Google',
        userinfo_failed: 'Failed to get user info from Google',
        invalid_domain: 'Please use your @kartel.ai email',
        oauth_failed: 'Google sign-in failed. Please try again.',
      }
      setLocalError(errorMessages[oauthError] || 'Sign-in failed')
    }
  }, [searchParams, setToken, navigate])

  const clearErrors = () => {
    setLocalError('')
    clearError()
  }

  // Check if email is work email (not gmail, yahoo, etc.)
  const isWorkEmail = (email: string) => {
    const personalDomains = [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
      'icloud.com', 'me.com', 'mac.com', 'live.com', 'msn.com',
      'protonmail.com', 'proton.me', 'mail.com', 'zoho.com'
    ]
    const domain = email.split('@')[1]?.toLowerCase()
    return domain && !personalDomains.includes(domain)
  }

  const getCompanyFromEmail = (email: string) => {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) return ''
    const company = domain.split('.')[0]
    return company.charAt(0).toUpperCase() + company.slice(1)
  }

  const handleSubmit = async () => {
    clearErrors()

    if (!email) {
      setLocalError('Please enter your email')
      return
    }

    if (!isWorkEmail(email)) {
      setLocalError('Please use your work email address')
      return
    }

    if (!password || password.length < 8) {
      setLocalError('Password must be at least 8 characters')
      return
    }

    if (!isLogin && !name) {
      setLocalError('Please enter your name')
      return
    }

    setIsSubmitting(true)

    try {
      if (isLogin) {
        await login(email, password)
      } else {
        await signup(email, password, name)
      }
      // Navigate to home after successful auth
      navigate('/')
    } catch (err) {
      console.error('Auth error:', err)
      if (!error) {
        setLocalError(err instanceof Error ? err.message : 'Something went wrong')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const displayError = localError || error

  // Welcome screen
  if (step === 'welcome') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="text-7xl mb-6">🧠</div>
          <h1 className="text-3xl font-bold mb-3">Brain Trust</h1>
          <p className="text-zinc-400 text-lg mb-12">
            AI-powered workspace for your team
          </p>

          {displayError && (
            <div className="text-red-500 text-sm bg-red-500/10 rounded-lg p-3 mb-6">
              {displayError}
            </div>
          )}

          <div className="space-y-3">
            {/* Google Sign In - primary action */}
            <button
              onClick={() => window.location.href = `${API_URL}/api/auth/google`}
              className="w-full bg-white text-black rounded-xl py-4 font-semibold hover:bg-zinc-200 transition-colors text-lg flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-zinc-600 text-sm">or</span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>

            <button
              onClick={() => { setIsLogin(false); setStep('form') }}
              className="w-full bg-zinc-900 text-white rounded-xl py-4 font-semibold hover:bg-zinc-800 transition-colors"
            >
              Sign up with email
            </button>
            <button
              onClick={() => { setIsLogin(true); setStep('form') }}
              className="w-full text-zinc-400 hover:text-white transition-colors py-2"
            >
              Already have an account? Sign in
            </button>
          </div>

          <p className="text-zinc-600 text-sm mt-8">
            Upload documents, chat with AI, collaborate with your team
          </p>
          <p className="text-cyan-600 text-xs mt-2">
            Currently limited to @kartel.ai accounts
          </p>
        </div>
      </div>
    )
  }

  // Form step
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <button
          onClick={() => { setStep('welcome'); clearErrors() }}
          className="text-zinc-500 hover:text-white mb-8 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">
            {isLogin ? 'Welcome back!' : 'Create your account'}
          </h1>
          <p className="text-zinc-400 text-sm">
            {isLogin
              ? 'Sign in to your workspace'
              : 'Use your work email to auto-join your company workspace'}
          </p>
        </div>

        <div className="space-y-4">
          {!isLogin && (
            <div>
              <label className="text-sm text-zinc-400 block mb-2">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full bg-zinc-900 rounded-xl px-4 py-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                autoFocus={!isLogin}
              />
            </div>
          )}

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Work email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full bg-zinc-900 rounded-xl px-4 py-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              autoFocus={isLogin}
            />
            {!isLogin && email && isWorkEmail(email) && (
              <p className="text-xs text-cyan-500 mt-2">
                You'll join the <strong>{getCompanyFromEmail(email)}</strong> workspace
              </p>
            )}
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-zinc-900 rounded-xl px-4 py-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            {!isLogin && (
              <p className="text-xs text-zinc-600 mt-2">At least 8 characters</p>
            )}
          </div>

          {displayError && (
            <div className="text-red-500 text-sm bg-red-500/10 rounded-lg p-3">
              {displayError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full bg-white text-black rounded-xl py-4 font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Loading...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>

          <p className="text-center text-sm text-zinc-500">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setIsLogin(!isLogin); clearErrors() }}
              className="text-cyan-500 hover:underline"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

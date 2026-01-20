import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'

interface ApiKeyStatus {
  provider: string
  has_key: boolean
  is_valid: boolean
}

const PROVIDERS = [
  {
    id: 'claude',
    name: 'Anthropic Claude',
    description: 'Claude Sonnet - Best for nuanced conversations',
    keyPlaceholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o - Great all-around performance',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 1.5 Flash - Fast and capable',
    keyPlaceholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
]

export default function Settings() {
  const [keys, setKeys] = useState<ApiKeyStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadKeys()
  }, [])

  const loadKeys = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/settings/api-keys', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      setKeys(data.keys || [])
    } catch {
      console.error('Failed to load API keys')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveKey = async (provider: string) => {
    if (!newKey.trim()) {
      setError('Please enter an API key')
      return
    }

    setValidating(true)
    setError('')

    try {
      const token = localStorage.getItem('token')

      // First validate the key
      const validateRes = await fetch('/api/settings/api-keys/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provider, key: newKey }),
      })
      const validateData = await validateRes.json()

      if (!validateData.isValid) {
        setError(validateData.error || 'Invalid API key')
        setValidating(false)
        return
      }

      // Save the key
      await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provider, key: newKey }),
      })

      setSuccess('API key saved successfully!')
      setNewKey('')
      setEditingProvider(null)
      loadKeys()

      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('Failed to save API key')
    } finally {
      setValidating(false)
    }
  }

  const handleDeleteKey = async (provider: string) => {
    if (!confirm('Are you sure you want to remove this API key?')) return

    try {
      const token = localStorage.getItem('token')
      await fetch(`/api/settings/api-keys/${provider}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      loadKeys()
    } catch {
      setError('Failed to delete API key')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/groups')}
              className="text-zinc-400 hover:text-white"
            >
              ←
            </button>
            <h1 className="font-semibold">Settings</h1>
          </div>
          <button
            onClick={logout}
            className="text-sm text-zinc-500 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4">
        {/* User Info */}
        <div className="bg-zinc-900 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-xl">
              {user?.name?.charAt(0) || '?'}
            </div>
            <div>
              <div className="font-medium">{user?.name}</div>
              <div className="text-sm text-zinc-500">{user?.email}</div>
            </div>
          </div>
        </div>

        {/* API Keys Section */}
        <h2 className="text-sm text-zinc-500 mb-3">AI Provider API Keys</h2>
        <p className="text-xs text-zinc-600 mb-4">
          Add your own API keys to enable Brain. Your keys are encrypted and
          stored securely. You only pay for what you use.
        </p>

        {success && (
          <div className="bg-green-500/10 text-green-500 text-sm rounded-lg p-3 mb-4">
            {success}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-zinc-500">Loading...</div>
        ) : (
          <div className="space-y-3">
            {PROVIDERS.map((provider) => {
              const keyStatus = keys.find((k) => k.provider === provider.id)
              const isEditing = editingProvider === provider.id

              return (
                <div
                  key={provider.id}
                  className="bg-zinc-900 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {provider.name}
                        {keyStatus?.has_key && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              keyStatus.is_valid
                                ? 'bg-green-500/20 text-green-500'
                                : 'bg-red-500/20 text-red-500'
                            }`}
                          >
                            {keyStatus.is_valid ? 'Active' : 'Invalid'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {provider.description}
                      </p>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-3">
                      <input
                        type="password"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder={provider.keyPlaceholder}
                        className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                      {error && (
                        <p className="text-red-500 text-xs mb-2">{error}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingProvider(null)
                            setNewKey('')
                            setError('')
                          }}
                          className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveKey(provider.id)}
                          disabled={validating}
                          className="flex-1 bg-white text-black rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                        >
                          {validating ? 'Validating...' : 'Save'}
                        </button>
                      </div>
                      <a
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-500 mt-2 block hover:underline"
                      >
                        Get an API key →
                      </a>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          setEditingProvider(provider.id)
                          setNewKey('')
                          setError('')
                        }}
                        className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm hover:bg-zinc-700"
                      >
                        {keyStatus?.has_key ? 'Update Key' : 'Add Key'}
                      </button>
                      {keyStatus?.has_key && (
                        <button
                          onClick={() => handleDeleteKey(provider.id)}
                          className="px-4 bg-red-500/20 text-red-500 rounded-lg py-2 text-sm hover:bg-red-500/30"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Info */}
        <div className="mt-6 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <h3 className="text-sm font-medium mb-2">How it works</h3>
          <ul className="text-xs text-zinc-500 space-y-1">
            <li>• Brain uses your API key to respond to @brain mentions</li>
            <li>• Keys are encrypted before storage</li>
            <li>• You're only charged by the AI provider for usage</li>
            <li>• No API key? Brain will use helpful mock responses</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

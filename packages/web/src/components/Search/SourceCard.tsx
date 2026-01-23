interface SourceCardProps {
  name: string
  icon: string
  connected: boolean
  itemCount?: number
  status?: 'active' | 'syncing' | 'error' | 'disconnected'
  onConnect: () => void
  onOpen: () => void
  comingSoon?: boolean
}

export default function SourceCard({
  name,
  icon,
  connected,
  itemCount,
  status,
  onConnect,
  onOpen,
  comingSoon,
}: SourceCardProps) {
  return (
    <div
      className={`relative bg-zinc-900 border rounded-xl p-4 transition-all ${
        connected
          ? 'border-zinc-700 hover:border-zinc-600'
          : 'border-zinc-800 hover:border-zinc-700'
      } ${comingSoon ? 'opacity-50' : ''}`}
    >
      {/* Icon and name */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <span className="font-medium text-sm">{name}</span>
      </div>

      {/* Status */}
      {connected ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            {status === 'syncing' ? (
              <>
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                <span className="text-xs text-yellow-500">Syncing...</span>
              </>
            ) : status === 'error' ? (
              <>
                <div className="w-2 h-2 bg-red-500 rounded-full" />
                <span className="text-xs text-red-500">Error</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-xs text-zinc-500">
                  {itemCount?.toLocaleString() || 0} items
                </span>
              </>
            )}
          </div>
          <button
            onClick={onOpen}
            className="w-full py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Open
          </button>
        </div>
      ) : comingSoon ? (
        <div className="text-xs text-zinc-600">Coming soon</div>
      ) : (
        <button
          onClick={onConnect}
          className="w-full py-1.5 text-xs bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 rounded-lg transition-colors"
        >
          Connect
        </button>
      )}

      {/* Connected indicator */}
      {connected && (
        <div className="absolute top-2 right-2">
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </div>
  )
}

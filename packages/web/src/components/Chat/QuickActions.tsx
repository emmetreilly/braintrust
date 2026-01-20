interface QuickActionsProps {
  onAction: (action: string) => void
}

const actions = [
  { id: 'catchup', label: '🧠 Catch up' },
  { id: 'factcheck', label: '✓ Fact check' },
  { id: 'similar', label: '🔍 Similar' },
  { id: 'private', label: '💭 Private' },
]

export default function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <div className="px-4 py-2 flex gap-2 overflow-x-auto border-t border-zinc-900 hide-scrollbar">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => onAction(action.id)}
          className="text-xs bg-zinc-900 px-3 py-2 rounded-full whitespace-nowrap hover:bg-zinc-800 transition-colors"
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

interface QuickActionsProps {
  onAction: (action: string) => void
}

const actions = [
  { id: 'docs', label: '📄 Docs', tip: 'View and create documents' },
  { id: 'catchup', label: '🧠 Catch up', tip: 'Get summary of what you missed' },
  { id: 'weekly', label: '📝 Weekly', tip: 'Weekly conversation summary' },
  { id: 'factcheck', label: '✓ Fact check', tip: 'Verify claims in conversation' },
  { id: 'recommend', label: '💡 Recommend', tip: 'Get content suggestions' },
  { id: 'memory', label: '🔍 Memory', tip: 'Search past conversations' },
  { id: 'private', label: '💭 Private', tip: 'Chat privately with Brain' },
]

export default function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <div className="px-4 py-2 flex gap-2 overflow-x-auto border-t border-zinc-900 hide-scrollbar">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => onAction(action.id)}
          className="text-xs bg-zinc-900 px-3 py-2 rounded-full whitespace-nowrap hover:bg-zinc-800 transition-colors"
          title={action.tip}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

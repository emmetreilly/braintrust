interface QuickActionsProps {
  onAction: (action: string) => void
}

const actions = [
  { id: 'catchup', label: '🧠 Catch me up', tip: 'Summary of last 24 hours, recent docs' },
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

import { useDrag } from 'react-dnd'
import { DragTypes } from '../ui/DragDropContext'

interface InsightCardProps {
  content: string
  authorName?: string
  documentName?: string
  onFollowup?: (question: string) => Promise<void>
  onClick?: () => void
}

// Minimal shared AI content - Slack-style, just text
// Small "via AI" indicator, draggable
export default function InsightCard({
  content,
  authorName,
}: InsightCardProps) {
  // Clean up the content - remove any headers
  const cleanContent = content
    .replace(/🧠 \*\*Brain insight.*?\*\*:?\n\n?/g, '')
    .trim()

  // Make draggable back to Brain
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DragTypes.MESSAGE_TEXT,
    item: {
      type: DragTypes.MESSAGE_TEXT,
      content: cleanContent,
      messageId: `insight-${Date.now()}`,
      authorName: 'Brain',
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [cleanContent])

  return (
    <div
      ref={drag}
      className={`${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Just the content */}
      <p className="text-sm whitespace-pre-line">{cleanContent}</p>

      {/* Tiny indicator */}
      <span className="text-[10px] text-zinc-600 mt-1 block">
        via AI{authorName ? ` · ${authorName}` : ''}
      </span>
    </div>
  )
}

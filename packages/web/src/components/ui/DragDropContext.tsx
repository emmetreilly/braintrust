import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { ReactNode } from 'react'

// Drag item types
export const DragTypes = {
  MESSAGE_TEXT: 'MESSAGE_TEXT',
  BRAIN_RESPONSE: 'BRAIN_RESPONSE',
  MEDIA_FILE: 'MEDIA_FILE',
} as const

// Drag item interfaces
export interface MessageDragItem {
  type: typeof DragTypes.MESSAGE_TEXT
  content: string
  messageId: string
  authorName?: string
}

export interface BrainDragItem {
  type: typeof DragTypes.BRAIN_RESPONSE
  content: string
  documentContext?: { id: string; name: string }
}

export interface FileDragItem {
  type: typeof DragTypes.MEDIA_FILE
  fileId: string
  filename: string
  fileType: string
}

export type DragItem = MessageDragItem | BrainDragItem | FileDragItem

export function DragDropProvider({ children }: { children: ReactNode }) {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>
}

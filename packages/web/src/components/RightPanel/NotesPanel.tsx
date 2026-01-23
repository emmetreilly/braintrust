import { useState, useEffect } from 'react'
import { useChatStore } from '../../stores/chat'

interface Note {
  id: string
  content: string
  createdAt: string
  completed?: boolean
}

export default function NotesPanel() {
  const { groupId } = useChatStore()
  const [notes, setNotes] = useState<Note[]>([])
  const [newNote, setNewNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  // Load notes from localStorage (per channel)
  useEffect(() => {
    if (!groupId) return
    const stored = localStorage.getItem(`notes-${groupId}`)
    if (stored) {
      try {
        setNotes(JSON.parse(stored))
      } catch {
        setNotes([])
      }
    } else {
      setNotes([])
    }
  }, [groupId])

  // Save notes to localStorage
  const saveNotes = (updatedNotes: Note[]) => {
    if (!groupId) return
    localStorage.setItem(`notes-${groupId}`, JSON.stringify(updatedNotes))
    setNotes(updatedNotes)
  }

  const addNote = () => {
    if (!newNote.trim()) return
    const note: Note = {
      id: `note-${Date.now()}`,
      content: newNote.trim(),
      createdAt: new Date().toISOString(),
      completed: false,
    }
    saveNotes([note, ...notes])
    setNewNote('')
  }

  const toggleComplete = (id: string) => {
    saveNotes(
      notes.map((n) =>
        n.id === id ? { ...n, completed: !n.completed } : n
      )
    )
  }

  const deleteNote = (id: string) => {
    saveNotes(notes.filter((n) => n.id !== id))
  }

  const startEdit = (note: Note) => {
    setEditingId(note.id)
    setEditContent(note.content)
  }

  const saveEdit = () => {
    if (!editingId || !editContent.trim()) return
    saveNotes(
      notes.map((n) =>
        n.id === editingId ? { ...n, content: editContent.trim() } : n
      )
    )
    setEditingId(null)
    setEditContent('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
  }

  const activeNotes = notes.filter((n) => !n.completed)
  const completedNotes = notes.filter((n) => n.completed)

  return (
    <div className="h-full flex flex-col">
      {/* Add note input */}
      <div className="p-3 border-b border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                addNote()
              }
            }}
            placeholder="Add a note or task..."
            className="flex-1 bg-zinc-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
          <button
            onClick={addNote}
            disabled={!newNote.trim()}
            className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-auto">
        {notes.length === 0 ? (
          <div className="p-4 text-center text-zinc-600">
            <p className="text-sm">No notes yet</p>
            <p className="text-xs mt-1 text-zinc-700">Add notes, tasks, or reminders</p>
          </div>
        ) : (
          <div className="py-2">
            {/* Active notes */}
            {activeNotes.map((note) => (
              <div
                key={note.id}
                className="group px-3 py-2 hover:bg-zinc-900/50 transition-colors"
              >
                {editingId === note.id ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit()
                        if (e.key === 'Escape') cancelEdit()
                      }}
                      className="flex-1 bg-zinc-800 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      autoFocus
                    />
                    <button
                      onClick={saveEdit}
                      className="text-cyan-400 hover:text-cyan-300 text-sm"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-zinc-500 hover:text-zinc-300 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => toggleComplete(note.id)}
                      className="mt-0.5 w-4 h-4 rounded border border-zinc-600 hover:border-cyan-500 flex-shrink-0 transition-colors"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 break-words">{note.content}</p>
                      <p className="text-[10px] text-zinc-600 mt-1">
                        {new Date(note.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                      <button
                        onClick={() => startEdit(note)}
                        className="p-1 text-zinc-500 hover:text-white"
                        title="Edit"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteNote(note.id)}
                        className="p-1 text-zinc-500 hover:text-red-400"
                        title="Delete"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Completed notes */}
            {completedNotes.length > 0 && (
              <>
                <div className="px-3 py-2 mt-2">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider">
                    Completed ({completedNotes.length})
                  </p>
                </div>
                {completedNotes.map((note) => (
                  <div
                    key={note.id}
                    className="group px-3 py-2 hover:bg-zinc-900/50 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => toggleComplete(note.id)}
                        className="mt-0.5 w-4 h-4 rounded bg-cyan-600 flex-shrink-0 flex items-center justify-center"
                      >
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-500 line-through break-words">{note.content}</p>
                      </div>
                      <button
                        onClick={() => deleteNote(note.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-opacity"
                        title="Delete"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-600 text-center">
        Notes are saved per channel
      </div>
    </div>
  )
}

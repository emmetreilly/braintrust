import { useState } from 'react'
import AIWorkspacePanel from '../AIWorkspace/AIWorkspacePanel'
import MediaLibraryPanel from '../MediaLibrary/MediaLibraryPanel'
import NotesPanel from './NotesPanel'

type RightPanelTab = 'notes' | 'brain' | 'files'

export default function RightPanel() {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('brain')

  const tabs: { id: RightPanelTab; label: string; icon: string }[] = [
    { id: 'notes', label: 'Notes', icon: '📝' },
    { id: 'brain', label: 'Brain', icon: '🧠' },
    { id: 'files', label: 'Files', icon: '📁' },
  ]

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Tab bar */}
      <div className="flex items-center border-b border-zinc-800 bg-zinc-900">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-white border-cyan-500 bg-zinc-800/50'
                : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
          >
            <span className="text-xs">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'notes' && <NotesPanel />}
        {activeTab === 'brain' && <AIWorkspacePanel />}
        {activeTab === 'files' && <MediaLibraryPanel />}
      </div>
    </div>
  )
}

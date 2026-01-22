import BrainThread from './BrainThread'

interface AIWorkspacePanelProps {
  className?: string
}

export default function AIWorkspacePanel({ className = '' }: AIWorkspacePanelProps) {
  return (
    <div className={`w-full h-screen flex flex-col bg-zinc-950 ${className}`}>
      <BrainThread />
    </div>
  )
}

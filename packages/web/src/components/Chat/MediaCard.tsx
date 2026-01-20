import type { MediaData } from '../../types'

interface MediaCardProps {
  media: MediaData
  onTap: () => void
}

export default function MediaCard({ media, onTap }: MediaCardProps) {
  if (media.type === 'tweet') {
    return (
      <div
        className="bg-zinc-900 rounded-2xl p-3 border border-zinc-800 cursor-pointer max-w-xs"
        onClick={onTap}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-zinc-700 rounded-full" />
          <span className="text-sm font-medium">{media.siteName}</span>
          <span className="text-xs text-zinc-500">· 𝕏</span>
        </div>
        <p className="text-sm">{media.title}</p>
        <div className="text-xs text-zinc-600 mt-2">Tap to expand</div>
      </div>
    )
  }

  return (
    <div
      className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 cursor-pointer max-w-xs"
      onClick={onTap}
    >
      {media.image && (
        <img src={media.image} alt="" className="w-full h-32 object-cover" />
      )}
      <div className="p-3">
        <div className="text-xs text-zinc-500 mb-1">{media.siteName}</div>
        <p className="text-sm font-medium">{media.title}</p>
        {media.description && (
          <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
            {media.description}
          </p>
        )}
      </div>
    </div>
  )
}

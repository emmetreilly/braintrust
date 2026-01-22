import { useState, useRef, useCallback, ReactNode, useEffect } from 'react'

interface ResizablePanelGroupProps {
  direction: 'horizontal' | 'vertical'
  children: ReactNode
  className?: string
  storageKey?: string // For persisting split ratio
}

interface ResizablePanelProps {
  defaultSize?: number // Percentage (0-100)
  minSize?: number // Minimum percentage
  maxSize?: number // Maximum percentage
  children: ReactNode
  className?: string
}

// Simple implementation without context for now - just use CSS flexbox with a draggable divider
export function ResizablePanelGroup({
  direction,
  children,
  className = '',
  storageKey
}: ResizablePanelGroupProps) {
  // Extract panels and handles from children
  const childArray = Array.isArray(children) ? children : [children]

  // Get default sizes from panel children
  const panels: { defaultSize: number; minSize: number; maxSize: number; content: ReactNode }[] = []

  childArray.forEach((child: any) => {
    if (child?.type?.displayName === 'ResizablePanel') {
      panels.push({
        defaultSize: child.props.defaultSize || 50,
        minSize: child.props.minSize || 10,
        maxSize: child.props.maxSize || 90,
        content: child.props.children,
      })
    }
  })

  // Initialize sizes from storage or defaults
  const [sizes, setSizes] = useState<number[]>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(`resize-${storageKey}`)
      if (stored) {
        try {
          return JSON.parse(stored)
        } catch {}
      }
    }
    return panels.map(p => p.defaultSize)
  })

  // Persist sizes to storage
  useEffect(() => {
    if (storageKey && sizes.length > 0) {
      localStorage.setItem(`resize-${storageKey}`, JSON.stringify(sizes))
    }
  }, [sizes, storageKey])

  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const handleMouseDown = useCallback((index: number) => {
    setIsDragging(true)
    setDragIndex(index)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || dragIndex === null || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const totalSize = direction === 'vertical' ? rect.height : rect.width
    const position = direction === 'vertical'
      ? e.clientY - rect.top
      : e.clientX - rect.left

    const percentage = (position / totalSize) * 100

    // Calculate new sizes
    const newSizes = [...sizes]
    const panel1 = panels[dragIndex]
    const panel2 = panels[dragIndex + 1]

    // Clamp to min/max
    const newSize1 = Math.min(Math.max(percentage, panel1.minSize), panel1.maxSize)
    const newSize2 = 100 - newSize1

    if (newSize2 >= panel2.minSize && newSize2 <= panel2.maxSize) {
      newSizes[dragIndex] = newSize1
      newSizes[dragIndex + 1] = newSize2
      setSizes(newSizes)
    }
  }, [isDragging, dragIndex, direction, sizes, panels])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragIndex(null)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = direction === 'vertical' ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, handleMouseMove, handleMouseUp, direction])

  return (
    <div
      ref={containerRef}
      className={`flex ${direction === 'vertical' ? 'flex-col' : 'flex-row'} h-full w-full ${className}`}
    >
      {panels.map((panel, index) => (
        <div key={index} className="contents">
          <div
            style={{
              [direction === 'vertical' ? 'height' : 'width']: `${sizes[index] || panel.defaultSize}%`,
              minHeight: direction === 'vertical' ? 0 : undefined,
              minWidth: direction === 'horizontal' ? 0 : undefined,
            }}
            className="overflow-hidden"
          >
            {panel.content}
          </div>
          {index < panels.length - 1 && (
            <div
              onMouseDown={() => handleMouseDown(index)}
              className={`
                ${direction === 'vertical'
                  ? 'h-1 w-full cursor-row-resize hover:bg-cyan-500/50'
                  : 'w-1 h-full cursor-col-resize hover:bg-cyan-500/50'
                }
                bg-zinc-700 flex-shrink-0 transition-colors
                ${isDragging && dragIndex === index ? 'bg-cyan-500' : ''}
              `}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export function ResizablePanel({ children, className = '' }: ResizablePanelProps) {
  return <div className={`h-full w-full ${className}`}>{children}</div>
}
ResizablePanel.displayName = 'ResizablePanel'

export function ResizableHandle() {
  // This is just a marker component, actual handle is rendered by ResizablePanelGroup
  return null
}
ResizableHandle.displayName = 'ResizableHandle'

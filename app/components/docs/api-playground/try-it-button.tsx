'use client'

import { usePlayground } from './context'
import { cn } from '@/lib/utils'

interface TryItButtonProps {
  operationId: string
  method: string
  path: string
}

function methodColor(method: string) {
  switch (method.toUpperCase()) {
    case 'GET': return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
    case 'POST': return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
    case 'PUT': return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    case 'PATCH': return 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
    case 'DELETE': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
    default: return 'text-muted-foreground bg-muted border-border'
  }
}

export function TryItButton({ operationId, method, path }: TryItButtonProps) {
  const { openPlayground } = usePlayground()

  return (
    <div className="flex items-center justify-between gap-3 my-6 p-3 rounded-xl border border-border bg-muted/30">
      {/* Method + path */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn(
          'font-mono font-bold text-xs px-2 py-1 rounded border shrink-0',
          methodColor(method)
        )}>
          {method.toUpperCase()}
        </span>
        <code className="text-sm text-foreground font-mono truncate">{path}</code>
      </div>

      {/* Try it button */}
      <button
        onClick={() => openPlayground(operationId)}
        className={cn(
          'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
          'bg-[var(--accent)] text-white hover:opacity-90 transition-opacity',
        )}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
        Try it
      </button>
    </div>
  )
}

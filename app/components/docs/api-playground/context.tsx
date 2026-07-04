'use client'

import { createContext, useContext, useState, useCallback } from 'react'

interface PlaygroundContextValue {
  isOpen: boolean
  selectedOperationId: string | null
  openPlayground: (operationId: string) => void
  closePlayground: () => void
  setSelectedOperationId: (id: string) => void
}

const PlaygroundContext = createContext<PlaygroundContextValue | null>(null)

export function PlaygroundProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)

  const openPlayground = useCallback((operationId: string) => {
    setSelectedOperationId(operationId)
    setIsOpen(true)
  }, [])

  const closePlayground = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <PlaygroundContext.Provider
      value={{ isOpen, selectedOperationId, openPlayground, closePlayground, setSelectedOperationId }}
    >
      {children}
    </PlaygroundContext.Provider>
  )
}

export function usePlayground() {
  const ctx = useContext(PlaygroundContext)
  if (!ctx) throw new Error('usePlayground must be used inside PlaygroundProvider')
  return ctx
}

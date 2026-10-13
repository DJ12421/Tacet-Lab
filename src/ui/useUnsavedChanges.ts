import { useEffect, useRef, useSyncExternalStore } from 'react'

const pending = new Set<symbol>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const notify = () => listeners.forEach((listener) => listener())

export function useUnsavedChanges(dirty: boolean) {
  const token = useRef(Symbol('unsaved changes'))
  useEffect(() => {
    if (!dirty) return
    pending.add(token.current)
    notify()
    return () => { pending.delete(token.current); notify() }
  }, [dirty])
}

export function useAnyUnsavedChanges() {
  return useSyncExternalStore(subscribe, () => pending.size > 0, () => false)
}

export function confirmDiscardChanges(dirty: boolean) {
  return !dirty || window.confirm('Discard your unsaved changes?')
}

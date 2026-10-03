import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

const storageKey = (key: string) => `tacet-lab:teams:${key}`

export function useWorkspacePreference<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey(key))
      if (saved === null) return fallback
      const parsed: unknown = JSON.parse(saved)
      return (Array.isArray(fallback) ? Array.isArray(parsed) : typeof parsed === typeof fallback) ? parsed as T : fallback
    } catch { return fallback }
  })
  useEffect(() => {
    try { window.localStorage.setItem(storageKey(key), JSON.stringify(value)) }
    catch { /* Keep the selection for this session if browser storage is unavailable. */ }
  }, [key, value])
  return [value, setValue]
}

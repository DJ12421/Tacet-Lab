import { useSyncExternalStore } from 'react'

const isFocused = () => document.visibilityState === 'visible' && document.hasFocus()

const subscribe = (notify: () => void) => {
  window.addEventListener('focus', notify)
  window.addEventListener('blur', notify)
  document.addEventListener('visibilitychange', notify)
  return () => {
    window.removeEventListener('focus', notify)
    window.removeEventListener('blur', notify)
    document.removeEventListener('visibilitychange', notify)
  }
}

export const usePageFocused = () => useSyncExternalStore(subscribe, isFocused, () => true)

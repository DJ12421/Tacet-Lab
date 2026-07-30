import { useEffect, type RefObject } from 'react'

export function useDismissableLayer<T extends HTMLElement>(open: boolean, ref: RefObject<T | null>, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return
    const dismissOutside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss()
    }
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissWithKeyboard)
    }
  }, [onDismiss, open, ref])
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
    }
  }, [locked])
}

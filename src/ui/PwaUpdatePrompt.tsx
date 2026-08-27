import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './pwa-update.css'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000
const UPDATE_RELOAD_MARKER = 'tacet-lab:update-reload'
const DEV_WORKER_CLEANUP_MARKER = 'tacet-lab:dev-worker-cleanup'

export function PwaUpdatePrompt({ safeToActivate, navigationVersion }: { safeToActivate: boolean; navigationVersion: number }) {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const pendingSinceNavigationRef = useRef<number | undefined>(undefined)
  const applyingRef = useRef(false)
  const launchWindowRef = useRef(true)
  const [waitingAtLaunch, setWaitingAtLaunch] = useState(false)
  const [updatedVersion, setUpdatedVersion] = useState('')
  const [error, setError] = useState('')
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_serviceWorkerUrl, registration) => {
      registrationRef.current = registration
      setWaitingAtLaunch(Boolean(registration?.waiting && navigator.serviceWorker.controller))
      void registration?.update()
    },
    onRegisterError: (registrationError) => console.error('Service worker registration failed.', registrationError)
  })

  useEffect(() => {
    if (!import.meta.env.DEV || !('serviceWorker' in navigator)) return
    let cancelled = false
    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      const wasControlled = Boolean(navigator.serviceWorker.controller)
      const removed = (await Promise.all(registrations.map((registration) => registration.unregister()))).some(Boolean)
      if (cancelled) return
      if ((wasControlled || removed) && sessionStorage.getItem(DEV_WORKER_CLEANUP_MARKER) !== 'done') {
        sessionStorage.setItem(DEV_WORKER_CLEANUP_MARKER, 'done')
        window.location.reload()
        return
      }
      sessionStorage.removeItem(DEV_WORKER_CLEANUP_MARKER)
    }).catch((cleanupError) => console.error('Development service worker cleanup failed.', cleanupError))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (sessionStorage.getItem(UPDATE_RELOAD_MARKER) !== 'pending') return
    sessionStorage.removeItem(UPDATE_RELOAD_MARKER)
    setUpdatedVersion(__APP_VERSION__)
    const timeout = window.setTimeout(() => setUpdatedVersion(''), 4_000)
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (navigationVersion > 0) launchWindowRef.current = false
    const timeout = window.setTimeout(() => { launchWindowRef.current = false }, 15_000)
    return () => window.clearTimeout(timeout)
  }, [navigationVersion])

  useEffect(() => {
    const checkForUpdate = () => {
      if (document.visibilityState === 'visible') void registrationRef.current?.update()
    }
    const interval = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', checkForUpdate)
    window.addEventListener('online', checkForUpdate)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', checkForUpdate)
      window.removeEventListener('online', checkForUpdate)
    }
  }, [])

  const applyUpdate = useCallback(async () => {
    if (applyingRef.current) return
    applyingRef.current = true
    setError('')
    sessionStorage.setItem(UPDATE_RELOAD_MARKER, 'pending')
    try {
      await updateServiceWorker(true)
    } catch (updateError) {
      console.error('Service worker update failed.', updateError)
      sessionStorage.removeItem(UPDATE_RELOAD_MARKER)
      setError('Automatic update failed. It will retry on the next navigation.')
      applyingRef.current = false
    }
  }, [updateServiceWorker])

  useEffect(() => {
    if (!needRefresh) {
      pendingSinceNavigationRef.current = undefined
      return
    }
    pendingSinceNavigationRef.current ??= navigationVersion
    const reachedSafeNavigation = navigationVersion > pendingSinceNavigationRef.current
    const discoveredOnFreshLaunch = launchWindowRef.current && navigationVersion === 0
    if (safeToActivate && (waitingAtLaunch || discoveredOnFreshLaunch || reachedSafeNavigation)) void applyUpdate()
  }, [applyUpdate, navigationVersion, needRefresh, safeToActivate, waitingAtLaunch])

  if (updatedVersion) return <aside className="pwa-update-toast updated" role="status" aria-live="polite"><strong>Updated to version {updatedVersion}</strong></aside>
  if (error) return <aside className="pwa-update-toast update-error" role="status" aria-live="polite"><span>{error}</span></aside>
  return null
}

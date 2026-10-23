import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { AppSettings, AppView, CustomThemeColors } from '../domain/types'
import { clearAccount, db, saveSettings } from '../storage/database'
import { setEquippedEchoIds } from '../storage/loadouts'
import { clearEchoId } from '../domain/echo-slots'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { EchoEquipmentContext } from './components'
import { HomeView } from './HomeView'
import { ImportDataModal } from './ImportDataModal'
import { ExportDataModal } from './ExportDataModal'
import { LiveTutorial } from './LiveTutorial'
import { guideFor, type GuideCounts, type GuideId } from './guide-content'
import { Icon, PageHeader, Panel } from './primitives'
import { PwaUpdatePrompt } from './PwaUpdatePrompt'
import { TacetLabLogo } from './TacetLabLogo'
import { useAppData } from './useAppData'
import { useBodyScrollLock } from './useDismissableLayer'
import { usePageFocused } from './usePageFocused'
import { confirmDiscardChanges, useAnyUnsavedChanges, useUnsavedChanges } from './useUnsavedChanges'

const ArchiveView = lazy(() => import('./ArchiveView').then(({ ArchiveView }) => ({ default: ArchiveView })))
const CharacterInventory = lazy(() => import('./CharacterInventoryView').then(({ CharacterInventory }) => ({ default: CharacterInventory })))
const GuidesView = lazy(() => import('./GuidesView').then(({ GuidesView }) => ({ default: GuidesView })))
const InventoryView = lazy(() => import('./InventoryView').then(({ InventoryView }) => ({ default: InventoryView })))
const WeaponInventory = lazy(() => import('./OwnedInventoryView').then(({ WeaponInventory }) => ({ default: WeaponInventory })))
const PartnershipsView = lazy(() => import('./PartnershipsView').then(({ PartnershipsView }) => ({ default: PartnershipsView })))
const PrivacyLegalView = lazy(() => import('./PrivacyLegalView').then(({ PrivacyLegalView }) => ({ default: PrivacyLegalView })))
const ScannerView = lazy(() => import('./ScannerView').then(({ ScannerView }) => ({ default: ScannerView })))
const TeamsView = lazy(() => import('./TeamsView').then(({ TeamsView }) => ({ default: TeamsView })))
const sidebarIconRoot = `${import.meta.env.BASE_URL}sidebar-icons/`
type NavItem = { view: AppView; label: string; icon?: string; legacyIcon?: Parameters<typeof Icon>[0]['name'] }
const nav: NavItem[] = [
  { view: 'dashboard', label: 'Home', icon: 'home.svg' },
  { view: 'archive', label: 'Archive', icon: 'archive.svg' },
  { view: 'echoes', label: 'Echoes', icon: 'echoes.svg' },
  { view: 'weapons', label: 'Weapons', icon: 'weapons.svg' },
  { view: 'characters', label: 'Characters', icon: 'characters.svg' },
  { view: 'teams', label: 'Teams', icon: 'teams.webp' },
  { view: 'scanner', label: 'Scanner', legacyIcon: 'scan' }
]
const mobilePrimaryNav = nav.filter((item) => ['dashboard', 'echoes', 'characters', 'teams'].includes(item.view))
const mobileMoreNav = (['weapons', 'archive', 'scanner'] as AppView[]).flatMap((view) => nav.find((item) => item.view === view) ?? [])
const sidebarPinStorageKey = 'tacet-lab-sidebar-pinned'
const themes: AppSettings['theme'][] = ['spectro', 'glacio', 'fusion', 'electro', 'aero', 'havoc', 'light', 'custom']
const customThemeLabels: Record<keyof CustomThemeColors, string> = { accent: 'Accent', mint: 'Mint', background: 'Background', surface: 'Panels', text: 'Text' }
const hexRgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(', ')

function NavIcon({ item }: { item: NavItem }) {
  return item.legacyIcon ? <Icon name={item.legacyIcon}/> : <img className="sidebar-nav-icon" src={`${sidebarIconRoot}${item.icon}`} alt="" width="24" height="24"/>
}

const viewPaths: Record<AppView, string> = {
  dashboard: '',
  archive: 'archive',
  scanner: 'scanner',
  echoes: 'echoes',
  weapons: 'weapons',
  characters: 'characters',
  teams: 'teams',
  guides: 'guides',
  partnerships: 'partnerships',
  legal: 'privacy'
}
type ArchiveTab = 'characters' | 'weapons' | 'sonatas' | 'echoes'
type TeamSection = 'overview' | 'forte' | 'optimize' | 'theorizer' | 'rotation'
interface AppRoute {
  view: AppView
  guide?: string
  archiveTab?: ArchiveTab
  character?: string
  weapon?: string
  team?: string
  teamCharacter?: string
  teamSection?: TeamSection
}

const archiveTabPaths: Record<ArchiveTab, string> = { characters: 'char', weapons: 'weapon', sonatas: 'sonata', echoes: 'echoes' }
const archivePathTabs: Record<string, ArchiveTab> = {
  char: 'characters',
  character: 'characters',
  characters: 'characters',
  weapon: 'weapons',
  weapons: 'weapons',
  sonata: 'sonatas',
  sonatas: 'sonatas',
  echoes: 'echoes'
}
const teamSections = new Set<TeamSection>(['overview', 'forte', 'optimize', 'theorizer', 'rotation'])
const routeHeads = new Set(['home', ...Object.values(viewPaths).filter(Boolean)])
const initialUrl = new URL(window.location.href)
const restoredRoute = initialUrl.searchParams.get('__route')
const initialSegments = initialUrl.pathname.split('/').filter(Boolean)
const initialRouteIndex = initialSegments.findIndex((segment) => routeHeads.has(segment.toLowerCase()))
const appRootPath = restoredRoute
  ? `${initialUrl.pathname.replace(/\/?$/, '/')}`
  : initialRouteIndex >= 0
    ? `/${initialSegments.slice(0, initialRouteIndex).join('/')}${initialRouteIndex > 0 ? '/' : ''}`
    : `${initialUrl.pathname.replace(/\/?$/, '/')}`
if (restoredRoute) {
  initialUrl.searchParams.delete('__route')
  const restoredPath = `${appRootPath}${restoredRoute.replace(/^\/+/, '')}`
  window.history.replaceState({}, '', `${restoredPath}${initialUrl.search}${initialUrl.hash}`)
}

function routeSegments() {
  const rootSegments = appRootPath.split('/').filter(Boolean)
  return window.location.pathname.split('/').filter(Boolean).slice(rootSegments.length).map(decodeURIComponent)
}

function routeFromLocation(): AppRoute {
  const [head = 'home', second, third, fourth] = routeSegments()
  if (head === 'privacy') return { view: 'guides', guide: 'privacy' }
  if (head === 'guides') return { view: 'guides', guide: second }
  if (head === 'archive') return { view: 'archive', archiveTab: archivePathTabs[second] ?? 'characters' }
  if (head === 'characters') return { view: 'characters', character: second }
  if (head === 'weapons') return { view: 'weapons', weapon: second }
  if (head === 'teams') return {
    view: 'teams',
    team: second,
    teamCharacter: third,
    teamSection: teamSections.has(fourth as TeamSection) ? fourth as TeamSection : undefined
  }
  const entry = Object.entries(viewPaths).find(([, path]) => path === head)
  return { view: entry?.[0] as AppView ?? 'dashboard' }
}

function characterSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function routePath(route: AppRoute) {
  if (route.view === 'guides') return `guides${route.guide ? `/${encodeURIComponent(route.guide)}` : ''}`
  if (route.view === 'archive') return `archive/${archiveTabPaths[route.archiveTab ?? 'characters']}`
  if (route.view === 'characters') return `characters${route.character ? `/${encodeURIComponent(route.character)}` : ''}`
  if (route.view === 'weapons') return `weapons${route.weapon ? `/${encodeURIComponent(route.weapon)}` : ''}`
  if (route.view === 'teams') {
    const parts = ['teams', route.team, route.teamCharacter, route.teamSection].filter(Boolean)
    return parts.join('/')
  }
  return viewPaths[route.view]
}

function pathForRoute(route: AppRoute) {
  return `${appRootPath}${routePath(route)}` || '/'
}

export default function App() {
  const [route, setRouteState] = useState<AppRoute>(() => routeFromLocation())
  const view = route.view
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsFormDirty, setSettingsFormDirty] = useState(false)
  const settingsFormRef = useRef<HTMLFormElement>(null)
  const settingsBaselineRef = useRef('')
  const [themePreview, setThemePreview] = useState<AppSettings['theme'] | null>(null)
  const [customPreview, setCustomPreview] = useState<CustomThemeColors | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const mobileMoreRef = useRef<HTMLDialogElement>(null)
  const [toast, setToast] = useState('')
  const [scannerSessionAtRisk, setScannerSessionAtRisk] = useState(false)
  const [teamsGalleryRequest, setTeamsGalleryRequest] = useState(0)
  const [tutorialId, setTutorialId] = useState<GuideId | null>(null)
  const [tutorialFirstVisit, setTutorialFirstVisit] = useState(true)
  const [navigationVersion, setNavigationVersion] = useState(0)
  const previousView = useRef(view)
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try { return window.localStorage.getItem(sidebarPinStorageKey) === 'true' } catch { return false }
  })
  const [sidebarOpenOverride, setSidebarOpenOverride] = useState<boolean | null>(null)
  const data = useAppData()
  const pageFocused = usePageFocused()
  useEffect(() => {
    document.documentElement.classList.toggle('site-unfocused', !pageFocused)
    return () => document.documentElement.classList.remove('site-unfocused')
  }, [pageFocused])
  const settingsDirty = settingsOpen && (settingsFormDirty || (customPreview !== null && (Object.keys(data.settings.customTheme) as (keyof CustomThemeColors)[]).some((key) => customPreview[key] !== data.settings.customTheme[key])))
  useUnsavedChanges(settingsDirty)
  const anyUnsavedChanges = useAnyUnsavedChanges()
  useEffect(() => {
    if (!settingsOpen || !settingsFormRef.current) return
    settingsBaselineRef.current = JSON.stringify([...new FormData(settingsFormRef.current).entries()])
    setSettingsFormDirty(false)
  }, [settingsOpen])
  useEffect(() => {
    if (!anyUnsavedChanges && !scannerSessionAtRisk) return
    const warnOnUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnOnUnload)
    return () => window.removeEventListener('beforeunload', warnOnUnload)
  }, [anyUnsavedChanges, scannerSessionAtRisk])
  useEffect(() => {
    const root = document.documentElement
    const theme = themePreview ?? data.settings.theme
    root.dataset.theme = theme
    const colors = customPreview ?? data.settings.customTheme
    const properties = ['--theme-gold', '--gold-rgb', '--mint', '--site-mint', '--mint-rgb', '--bg', '--surface', '--surface-2', '--theme-text']
    if (theme === 'custom') {
      root.style.setProperty('--theme-gold', colors.accent)
      root.style.setProperty('--gold-rgb', hexRgb(colors.accent))
      root.style.setProperty('--mint', colors.mint)
      root.style.setProperty('--site-mint', colors.mint)
      root.style.setProperty('--mint-rgb', hexRgb(colors.mint))
      root.style.setProperty('--bg', colors.background)
      root.style.setProperty('--surface', colors.surface)
      root.style.setProperty('--surface-2', colors.surface)
      root.style.setProperty('--theme-text', colors.text)
    } else properties.forEach((property) => root.style.removeProperty(property))
  }, [data.settings.theme, data.settings.customTheme, themePreview, customPreview])
  useEffect(() => {
    if (!settingsOpen) { setThemePreview(null); setCustomPreview(null) }
  }, [settingsOpen])
  const sidebarOpen = sidebarPinned || (sidebarOpenOverride ?? view === 'dashboard')
  const sidebarReserved = sidebarPinned || (view === 'dashboard' && sidebarOpenOverride !== false)
  const mobileMoreActive = ['weapons', 'archive', 'scanner', 'guides', 'partnerships', 'legal'].includes(view)
  useBodyScrollLock(mobileMoreOpen)

  useEffect(() => {
    const dialog = mobileMoreRef.current
    if (!dialog) return
    if (mobileMoreOpen && !dialog.open) dialog.showModal()
    if (!mobileMoreOpen && dialog.open) dialog.close()
  }, [mobileMoreOpen])

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const confirmLeaveRoute = (nextRoute: AppRoute) => {
    if (view === 'scanner' && nextRoute.view !== 'scanner' && scannerSessionAtRisk) return window.confirm(`Leave the scanner? Screen sharing will stop and scanned Echo data that has not been saved will be lost.${anyUnsavedChanges ? ' Other unsaved changes will also be discarded.' : ''}`)
    return confirmDiscardChanges(anyUnsavedChanges)
  }
  const setRoute = (nextRoute: AppRoute, historyMode: 'push' | 'replace' = 'push') => {
    if (routePath(nextRoute) === routePath(route)) return true
    if (!confirmLeaveRoute(nextRoute)) return false
    if (nextRoute.view !== view && guideFor(view)) {
      try { window.localStorage.setItem(`tacet-lab-visited-${view}`, 'true') } catch { /* Local storage may be unavailable. */ }
    }
    if (route.view === 'teams' && route.teamCharacter && (nextRoute.view !== 'teams' || nextRoute.team !== route.team || nextRoute.teamCharacter !== route.teamCharacter || nextRoute.teamSection !== route.teamSection)) {
      try { window.localStorage.setItem(`tacet-lab-visited-${route.teamSection === 'optimize' ? 'optimizer' : route.teamSection ?? 'overview'}`, 'true') } catch { /* Local storage may be unavailable. */ }
    }
    setScannerSessionAtRisk(false)
    setSettingsOpen(false)
    setImportOpen(false)
    setExportOpen(false)
    setRouteState(nextRoute)
    window.history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ route: nextRoute }, '', pathForRoute(nextRoute))
    setNavigationVersion((version) => version + 1)
    return true
  }
  const setView = (nextView: AppView) => {
    const nextRoute: AppRoute = nextView === 'archive'
      ? { view: nextView, archiveTab: 'characters' }
      : { view: nextView }
    return setRoute(nextRoute)
  }
  const navigateFromShell = (nextView: AppView) => {
    setMobileMoreOpen(false)
    setSidebarOpenOverride(null)
    if (setView(nextView) && nextView === 'teams') setTeamsGalleryRequest((request) => request + 1)
  }
  const startTutorial = (id: GuideId) => {
    setTutorialFirstVisit(isFirstVisit(id))
    const destination: AppView = id === 'optimizer' || id === 'theorizer' || id === 'rotation' || id === 'overview' || id === 'forte' ? 'teams' : id === 'backup' ? view : id
    if (view === destination) { setTutorialId(id); return }
    if (setView(destination)) {
      if (destination === 'teams') setTeamsGalleryRequest((request) => request + 1)
      setTutorialId(id)
    }
  }
  const isFirstVisit = (id: GuideId) => {
    try { return window.localStorage.getItem(`tacet-lab-visited-${id}`) !== 'true' } catch { return true }
  }
  const closeTutorial = (completed: boolean) => {
    if (tutorialId) {
      try { window.localStorage.setItem(`tacet-lab-visited-${tutorialId}`, 'true') } catch { /* Local storage may be unavailable. */ }
    }
    if (completed && tutorialId) {
      try { window.localStorage.setItem(`tacet-lab-tutorial-${tutorialId}`, 'complete') } catch { /* Local storage may be unavailable. */ }
      notify('Tutorial complete')
    }
    setTutorialId(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.topbar-tutorial')?.focus())
  }
  useEffect(() => {
    const handleHistoryNavigation = () => {
      const nextRoute = routeFromLocation()
      if (routePath(nextRoute) === routePath(route)) return
      if (!confirmLeaveRoute(nextRoute)) {
        window.history.pushState({ route }, '', pathForRoute(route))
        return
      }
      setScannerSessionAtRisk(false)
      if (nextRoute.view !== view && guideFor(view)) {
        try { window.localStorage.setItem(`tacet-lab-visited-${view}`, 'true') } catch { /* Local storage may be unavailable. */ }
      }
      if (route.view === 'teams' && route.teamCharacter && (nextRoute.view !== 'teams' || nextRoute.team !== route.team || nextRoute.teamCharacter !== route.teamCharacter || nextRoute.teamSection !== route.teamSection)) {
        try { window.localStorage.setItem(`tacet-lab-visited-${route.teamSection === 'optimize' ? 'optimizer' : route.teamSection ?? 'overview'}`, 'true') } catch { /* Local storage may be unavailable. */ }
      }
      setSettingsOpen(false)
      setImportOpen(false)
      setExportOpen(false)
      setRouteState(nextRoute)
      setNavigationVersion((version) => version + 1)
    }
    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [anyUnsavedChanges, route, scannerSessionAtRisk, view])
  useEffect(() => {
    const label = view === 'guides' ? route.guide === 'privacy' ? 'Privacy & Legal' : guideFor(route.guide)?.title ?? 'Guides' : nav.find((item) => item.view === view)?.label ?? (view === 'legal' ? 'Privacy & Legal' : view === 'partnerships' ? 'Partnerships' : 'Tacet Lab')
    document.title = view === 'dashboard' ? 'Tacet Lab | Wuthering Waves Optimizer & Echo Scanner' : `${label} | Tacet Lab`
  }, [route.guide, view])
  useEffect(() => {
    if (previousView.current !== view) window.scrollTo(0, 0)
    previousView.current = view
    const frame = requestAnimationFrame(() => {
      if (tutorialId || document.querySelector('[aria-modal="true"], dialog[open]')) return
      const search = document.querySelector<HTMLInputElement>('main input[data-search]')
      if (search?.getClientRects().length) search.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [navigationVersion, view])
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open]')).filter((dialog) => dialog.getClientRects().length)
      const scope = dialogs[dialogs.length - 1] ?? document.querySelector('main')
      if (!scope) return
      const searches = Array.from(scope.querySelectorAll<HTMLInputElement>('input[data-search]')).filter((input) => !input.disabled && input.getClientRects().length)
      const focused = document.activeElement
      const search = searches.find((input) => input === focused) ?? searches[searches.length - 1]
      if (!search) return
      event.preventDefault()
      search.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  useEffect(() => {
    try { window.localStorage.setItem(sidebarPinStorageKey, String(sidebarPinned)) } catch { /* Keep the preference session-only when storage is unavailable. */ }
  }, [sidebarPinned])
  const savePreferences = async (form: HTMLFormElement) => {
    const values = new FormData(form)
    await saveSettings({
      ...data.settings,
      displayName: String(values.get('displayName') || 'Resonator').trim() || 'Resonator',
      uid: String(values.get('uid') || '').trim(),
      roverGender: String(values.get('roverGender')) as typeof data.settings.roverGender,
      theme: themes.find((theme) => theme === values.get('theme')) ?? 'spectro',
      customTheme: customPreview ?? data.settings.customTheme,
      liveCharacterArt: values.has('liveCharacterArt')
    })
    await data.refresh()
    setSettingsFormDirty(false)
    setSettingsOpen(false)
    notify('Preferences saved')
  }
  const closeSettings = () => { if (confirmDiscardChanges(settingsDirty)) setSettingsOpen(false) }

  if (!data.ready) return <div className="boot"><TacetLabLogo className="boot-logo"/><span>INITIALIZING LOCAL ARCHIVE</span></div>
  if (data.error) return <div className="boot"><TacetLabLogo className="boot-logo"/><strong>LOCAL ARCHIVE UNAVAILABLE</strong><span>{data.error}</span><button className="secondary" onClick={() => location.reload()}>Retry</button></div>

  const owners = new Map<string, string[]>()
  for (const loadout of data.equippedLoadouts) for (const echoId of loadout.echoIds) if (echoId) owners.set(echoId, [...(owners.get(echoId) ?? []), loadout.characterId])
  const equipmentCharacters = data.characters.flatMap((character) => {
    const catalog = characterCatalog.find((entry) => entry.id === character.catalogId)
    return catalog ? [{ id: character.id, name: catalog.name, icon: catalog.iconSourceUrl }] : []
  })
  const buildLabels = new Map<string, string[]>()
  const buildOwners = new Map<string, string[]>()
  for (const build of data.builds) {
    if (!/^Build \d+$/.test(build.name)) continue
    const ownedCharacter = build.characterId
      ? data.characters.find((entry) => entry.id === build.characterId)
      : data.characters.find((entry) => entry.catalogId === build.resonatorId)
    const character = equipmentCharacters.find((entry) => entry.id === ownedCharacter?.id)
    if (!character) continue
    const label = `${character.name} · ${build.name}`
    for (const echoId of build.echoIds) if (echoId) {
      if (!buildLabels.get(echoId)?.includes(label)) buildLabels.set(echoId, [...(buildLabels.get(echoId) ?? []), label])
      if (!buildOwners.get(echoId)?.includes(character.id)) buildOwners.set(echoId, [...(buildOwners.get(echoId) ?? []), character.id])
    }
  }
  const equipment = {
    ownedIds: new Set(data.echoes.map((echo) => echo.id)), owners, buildLabels, buildOwners,
    characters: equipmentCharacters,
    toggle: async (echoId: string, characterId: string) => {
      try {
        const loadout = await db.equippedLoadouts.where('characterId').equals(characterId).first()
        const ids = loadout?.echoIds ?? []
        const nextIds = [...ids]
        if (ids.includes(echoId)) await setEquippedEchoIds(characterId, clearEchoId(ids, echoId))
        else {
          const emptySlot = nextIds.indexOf('')
          if (emptySlot >= 0) nextIds[emptySlot] = echoId
          else nextIds.push(echoId)
          await setEquippedEchoIds(characterId, nextIds)
        }
        await data.refresh('echoes-builds')
      } catch (error) { window.alert(error instanceof Error ? error.message : 'Could not change Echo equipment.') }
    },
    clear: async (echoId: string) => {
      try {
        for (const loadout of data.equippedLoadouts.filter((entry) => entry.echoIds.includes(echoId))) {
          await setEquippedEchoIds(loadout.characterId, clearEchoId(loadout.echoIds, echoId))
        }
        await data.refresh('echoes-builds')
      } catch (error) { window.alert(error instanceof Error ? error.message : 'Could not unequip this Echo.') }
    }
  }

  const guideCounts: GuideCounts = { echoes: data.echoes.length, weapons: data.weapons.length, characters: data.characters.length, teams: data.teams.length }
  const contextualGuideId: GuideId | undefined = view === 'teams' && route.teamCharacter
    ? (route.teamSection === 'optimize' ? 'optimizer' : route.teamSection ?? 'overview')
    : guideFor(view)?.id
  return <EchoEquipmentContext.Provider value={equipment}><div className={`app-shell ${view === 'dashboard' ? 'is-home' : ''} ${sidebarPinned ? 'sidebar-pinned' : ''} ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarReserved ? 'sidebar-reserved' : ''}`}>
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-controls">
        <span className="sidebar-label">Navigation</span>
        <button className="sidebar-pin" type="button" aria-pressed={sidebarPinned} title={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'} onClick={() => { setSidebarPinned(!sidebarPinned); setSidebarOpenOverride(sidebarPinned ? false : true) }}><svg className="sidebar-pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15.8 3.4 4.8 4.8-2.6 1.3-3.2 3.2.8 3.9-1.5 1.5-4.1-4.1-5.1 5.1-1.2-1.2 5.1-5.1-4.1-4.1 1.5-1.5 3.9.8 3.2-3.2 1.3-2.6Z"/></svg><span>{sidebarPinned ? 'Unpin' : 'Pin'}</span></button>
      </div>
      <button className="brand" onClick={() => setView('dashboard')}><div className="brand-mark"><i/><i/><i/></div><div><strong>TACET LAB</strong><span>BUILD PLANNER</span></div></button>
      <nav className="desktop-nav">{nav.map((item) => <button key={item.view} type="button" title={item.label} aria-current={view === item.view ? 'page' : undefined} className={view === item.view ? 'active' : ''} onClick={() => navigateFromShell(item.view)}><NavIcon item={item}/><span>{item.label}</span>{item.view === 'scanner' && <b>EN</b>}</button>)}</nav>
      <nav className="mobile-nav" aria-label="Mobile navigation">{mobilePrimaryNav.map((item) => <button key={item.view} type="button" aria-current={view === item.view ? 'page' : undefined} className={view === item.view ? 'active' : ''} onClick={() => navigateFromShell(item.view)}><NavIcon item={item}/><span>{item.label}</span></button>)}<button type="button" className={mobileMoreActive ? 'active' : ''} aria-current={mobileMoreActive ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={mobileMoreOpen} onClick={() => setMobileMoreOpen(true)}><Icon name="more"/><span>More</span></button></nav>
      <div className="side-bottom"><div className="local-status"><i/><div><strong>Local inventory</strong><span>{data.echoes.length} Echoes · {data.characters.length} characters · {data.weapons.length} weapons</span></div></div><button className={view === 'partnerships' ? 'active' : ''} onClick={() => setView('partnerships')}><Icon name="team"/><span>Partnerships</span></button><button className={view === 'guides' ? 'active' : ''} onClick={() => setView('guides')}><Icon name="info"/><span>Guides</span></button><button onClick={() => setSettingsOpen(true)}><Icon name="settings"/><span>Settings</span></button></div>
    </aside>
    <main>
      <div className="topbar"><div className="topbar-brand"><TacetLabLogo/></div><div>{contextualGuideId && <button type="button" className="topbar-tutorial" aria-label="Start live tutorial for this section" title="Guide me through this section" onClick={() => startTutorial(contextualGuideId)}><Icon name="info"/><span>Guide me</span></button>}<button type="button" aria-label="Import data" onClick={() => setImportOpen(true)}><Icon name="upload"/><span>Import</span></button><button type="button" aria-label="Export data" onClick={() => setExportOpen(true)}><Icon name="download"/><span>Export</span></button><button type="button" className="discord-button donation-button" aria-label="Donations (coming soon)" title="Donations coming soon" disabled><Icon name="donations"/></button><a className="discord-button" href="https://discord.gg/fy66NmapWb" target="_blank" rel="noreferrer" aria-label="Join the Tacet Lab Discord" title="Join the Tacet Lab Discord"><Icon name="discord"/></a></div></div>
      <div className={`content${view === 'teams' ? ' teams-content' : ''}`}>
        <Suspense key={view} fallback={<Panel>Loading…</Panel>}>
        {view === 'dashboard' && <HomeView echoes={data.echoes} characters={data.characters} weapons={data.weapons} builds={data.builds} teams={data.teams} roverGender={data.settings.roverGender} navigate={setView}/>}
        {view === 'archive' && <ArchiveView roverGender={data.settings.roverGender} tab={route.archiveTab ?? 'characters'} onTabChange={(archiveTab) => setRoute({ view: 'archive', archiveTab })}/>}
        {view === 'scanner' && <ScannerView echoes={data.echoes} refresh={data.refresh} onSessionRiskChange={setScannerSessionAtRisk}/>}
        {view === 'echoes' && <InventoryView echoes={data.echoes} builds={data.builds} equippedLoadouts={data.equippedLoadouts} characters={data.characters} refresh={data.refresh} openScanner={() => setView('scanner')}/>}
        {view === 'weapons' && <WeaponInventory owned={data.weapons} characters={data.characters} builds={data.builds} equippedLoadouts={data.equippedLoadouts} refresh={data.refresh} weaponIdentifier={route.weapon} onWeaponChange={(weapon) => setRoute({ view: 'weapons', weapon: weapon?.id })}/>}
        {view === 'characters' && <CharacterInventory owned={data.characters} weapons={data.weapons} echoes={data.echoes} builds={data.builds} equippedLoadouts={data.equippedLoadouts} theorycraftBuilds={data.theorycraftBuilds} teams={data.teams} settings={data.settings} roverGender={data.settings.roverGender} refresh={data.refresh} characterIdentifier={route.character} onCharacterChange={(entry) => setRoute({ view: 'characters', character: entry ? characterSlug(entry.name) : undefined })}/>}
        {view === 'teams' && <TeamsView echoes={data.echoes} builds={data.builds} equippedLoadouts={data.equippedLoadouts} theorycraftBuilds={data.theorycraftBuilds} teams={data.teams} characters={data.characters} weapons={data.weapons} refresh={data.refresh} openScanner={() => setView('scanner')} galleryRequest={teamsGalleryRequest} roverGender={data.settings.roverGender} route={{ team: route.team, character: route.teamCharacter, section: route.teamSection }} onRouteChange={(next) => setRoute({ view: 'teams', team: next.team, teamCharacter: next.character, teamSection: next.section })}/>} 
        {view === 'guides' && <GuidesView document={route.guide} counts={guideCounts} isFirstVisit={isFirstVisit} onSelect={(guide) => setRoute({ view: 'guides', guide })} onStart={startTutorial}/>}
        {view === 'partnerships' && <PartnershipsView/>}
        {view === 'legal' && <PrivacyLegalView/>}
        </Suspense>
      </div>
      <footer className="site-footer"><span>This is an independent fan project not affiliated with/endorsed by Wuthering Waves or Kuro Games.</span><span>Catalog version: 3.7</span></footer>
    </main>
    <dialog ref={mobileMoreRef} className="mobile-more-sheet" aria-labelledby="mobile-more-title" onClose={() => setMobileMoreOpen(false)} onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileMoreOpen(false) }}>
      <div className="mobile-more-handle" aria-hidden="true"/>
      <header><div><span className="eyebrow">Navigation</span><h2 id="mobile-more-title">More</h2></div><button type="button" className="close" aria-label="Close navigation menu" onClick={() => setMobileMoreOpen(false)}>×</button></header>
      <nav aria-label="More destinations">{mobileMoreNav.map((item) => <button key={item.view} type="button" aria-current={view === item.view ? 'page' : undefined} className={view === item.view ? 'active' : ''} onClick={() => navigateFromShell(item.view)}><NavIcon item={item}/><span><strong>{item.label}</strong>{item.view === 'scanner' && <small>Upload or enter Echoes manually on mobile</small>}</span></button>)}<button type="button" className={view === 'partnerships' ? 'active' : ''} aria-current={view === 'partnerships' ? 'page' : undefined} onClick={() => navigateFromShell('partnerships')}><Icon name="team"/><span><strong>Partnerships</strong><small>Community and creator spotlights</small></span></button><button type="button" className={view === 'guides' ? 'active' : ''} aria-current={view === 'guides' ? 'page' : undefined} onClick={() => navigateFromShell('guides')}><Icon name="info"/><span><strong>Guides</strong><small>Tutorials and Privacy &amp; Legal</small></span></button><button type="button" onClick={() => { setMobileMoreOpen(false); setSettingsOpen(true) }}><Icon name="settings"/><span><strong>Settings</strong><small>Appearance, build cards, and local data</small></span></button></nav>
    </dialog>
    {importOpen && <ImportDataModal onClose={() => setImportOpen(false)} onImported={async (preview) => { await data.refresh(); notify(`Import merged: ${preview.added} new, ${preview.updated} updated, ${preview.duplicates} duplicates skipped`) }}/>} 
    {exportOpen && <ExportDataModal onClose={() => setExportOpen(false)} onExported={() => notify('Backup download started')}/>}
    {tutorialId && <LiveTutorial key={tutorialId} id={tutorialId} counts={guideCounts} firstVisit={tutorialFirstVisit} onClose={closeTutorial}/>}
    {settingsOpen && <div className="modal-backdrop settings-backdrop" onMouseDown={closeSettings}><Panel className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="settings-header"><div><span className="eyebrow">Preferences · Local account</span><h2 id="settings-title">Settings</h2><p>Make Tacet Lab yours. Your choices stay in this browser.</p></div><button className="close" aria-label="Close settings" onClick={closeSettings}>×</button></div>
      <form ref={settingsFormRef} onChange={(event) => setSettingsFormDirty(JSON.stringify([...new FormData(event.currentTarget).entries()]) !== settingsBaselineRef.current)} onSubmit={(event) => { event.preventDefault(); void savePreferences(event.currentTarget) }}>
        <div className="settings-scroll">
        <section className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Icon name="settings"/></span><div><strong>Theme</strong><small>Choose an element color, a light palette, or your own colors.</small></div></div>
          <div className="settings-choice settings-theme-choice" role="radiogroup" aria-label="Site theme">
            {themes.map((theme) => <label key={theme}><input type="radio" name="theme" value={theme} defaultChecked={data.settings.theme === theme} onChange={() => setThemePreview(theme)}/><span><b>{theme[0].toUpperCase() + theme.slice(1)}</b></span></label>)}
          </div>
          {(themePreview ?? data.settings.theme) === 'custom' && <div className="settings-custom-colors">{(Object.keys(customThemeLabels) as (keyof CustomThemeColors)[]).map((key) => <label key={key}><span>{customThemeLabels[key]}</span><input type="color" aria-label={`${customThemeLabels[key]} color`} value={(customPreview ?? data.settings.customTheme)[key]} onChange={(event) => setCustomPreview({ ...(customPreview ?? data.settings.customTheme), [key]: event.target.value })}/></label>)}</div>}
        </section>
        <section className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><img src={`${import.meta.env.BASE_URL}black-shores-emblem.webp`} alt="" width="20" height="20"/></span><div><strong>Rover</strong><small>Used anywhere Rover appears.</small></div></div>
          <div className="settings-choice" role="radiogroup" aria-label="Rover appearance">
            <label><input type="radio" name="roverGender" value="male" defaultChecked={data.settings.roverGender === 'male'}/><span><b>Male Rover</b><small>Use the male artwork</small></span></label>
            <label><input type="radio" name="roverGender" value="female" defaultChecked={data.settings.roverGender === 'female'}/><span><b>Female Rover</b><small>Use the female artwork</small></span></label>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><img src={`${import.meta.env.BASE_URL}build-cards.webp`} alt="" width="20" height="20"/></span><div><strong>Build cards</strong><small>Applied to character cards.</small></div></div>
          <label className="settings-name-field"><span>Display name</span><input name="displayName" maxLength={40} defaultValue={data.settings.displayName} placeholder="Resonator"/></label>
          <label className="settings-name-field"><span>User UID</span><input name="uid" inputMode="numeric" maxLength={20} defaultValue={data.settings.uid} placeholder="Enter your in-game UID"/></label>
          <label className="settings-toggle"><input type="checkbox" name="liveCharacterArt" defaultChecked={data.settings.liveCharacterArt}/><span><b>Live character artwork</b><small>Animate character art while viewing build cards.</small></span></label>
        </section>
        <section className="settings-section settings-data-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Icon name="lock"/></span><div><strong>Your data</strong><small>Stored only in this browser.</small></div></div>
          <div className="settings-data-actions"><button type="button" className="secondary" onClick={() => { if (!confirmDiscardChanges(settingsDirty)) return; setSettingsOpen(false); setImportOpen(true) }}><Icon name="upload"/><span>Import</span></button><button type="button" className="secondary" onClick={() => { if (!confirmDiscardChanges(settingsDirty)) return; setSettingsOpen(false); setExportOpen(true) }}><Icon name="download"/><span>Export</span></button></div>
          <button type="button" className="danger text settings-delete" onClick={async () => { if (confirm('Delete all local Echoes, characters, weapons, builds, teams, and settings?')) { await clearAccount(); await data.refresh(); setSettingsOpen(false); notify('Local data cleared') } }}>Delete all local data</button>
        </section>
        </div>
        <div className="settings-save"><span>Changes apply when you save.</span><button className="primary" type="submit">Save changes</button></div>
      </form>
    </Panel></div>}
    {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    <PwaUpdatePrompt safeToActivate={!scannerSessionAtRisk && !anyUnsavedChanges && !importOpen && !exportOpen && !settingsOpen} navigationVersion={navigationVersion}/>
  </div></EchoEquipmentContext.Provider>
}

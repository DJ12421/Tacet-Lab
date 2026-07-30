import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { AppView } from '../domain/types'
import { clearAccount, exportAccount, importAccount, saveSettings, validateAccount } from '../storage/database'
import { Icon, PageHeader, Panel } from './primitives'
import { useAppData } from './useAppData'

const ArchiveView = lazy(() => import('./ArchiveView').then((module) => ({ default: module.ArchiveView })))
const CharacterInventory = lazy(() => import('./CharacterInventoryView').then((module) => ({ default: module.CharacterInventory })))
const HomeView = lazy(() => import('./HomeView').then((module) => ({ default: module.HomeView })))
const InventoryView = lazy(() => import('./InventoryView').then((module) => ({ default: module.InventoryView })))
const PrivacyLegalView = lazy(() => import('./PrivacyLegalView').then((module) => ({ default: module.PrivacyLegalView })))
const ScannerView = lazy(() => import('./ScannerView').then((module) => ({ default: module.ScannerView })))
const TeamsView = lazy(() => import('./TeamsView').then((module) => ({ default: module.TeamsView })))
const WeaponInventory = lazy(() => import('./OwnedInventoryView').then((module) => ({ default: module.WeaponInventory })))

const nav: Array<{ view: AppView; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { view: 'dashboard', label: 'Home', icon: 'home' },
  { view: 'archive', label: 'Archive', icon: 'build' },
  { view: 'echoes', label: 'Echoes', icon: 'echo' },
  { view: 'weapons', label: 'Weapons', icon: 'build' },
  { view: 'characters', label: 'Characters', icon: 'team' },
  { view: 'teams', label: 'Teams', icon: 'optimize' },
  { view: 'scanner', label: 'Scanner', icon: 'scan' }
]

const viewPaths: Record<AppView, string> = {
  dashboard: 'home',
  archive: 'archive',
  scanner: 'scanner',
  echoes: 'echoes',
  weapons: 'weapons',
  characters: 'characters',
  teams: 'teams',
  builds: 'builds',
  legal: 'privacy'
}
type ArchiveTab = 'characters' | 'weapons' | 'sonatas' | 'echoes'
type TeamSection = 'overview' | 'forte' | 'optimize' | 'rotation'
interface AppRoute {
  view: AppView
  archiveTab?: ArchiveTab
  character?: string
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
const teamSections = new Set<TeamSection>(['overview', 'forte', 'optimize', 'rotation'])
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
} else if (initialRouteIndex < 0) {
  window.history.replaceState({}, '', `${appRootPath}home${initialUrl.search}${initialUrl.hash}`)
}

function routeSegments() {
  const rootSegments = appRootPath.split('/').filter(Boolean)
  return window.location.pathname.split('/').filter(Boolean).slice(rootSegments.length).map(decodeURIComponent)
}

function routeFromLocation(): AppRoute {
  const [head = 'home', second, third, fourth] = routeSegments()
  if (head === 'archive') return { view: 'archive', archiveTab: archivePathTabs[second] ?? 'characters' }
  if (head === 'characters') return { view: 'characters', character: second }
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
  if (route.view === 'archive') return `archive/${archiveTabPaths[route.archiveTab ?? 'characters']}`
  if (route.view === 'characters') return `characters${route.character ? `/${encodeURIComponent(route.character)}` : ''}`
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
  const [toast, setToast] = useState('')
  const [scannerSessionAtRisk, setScannerSessionAtRisk] = useState(false)
  const [teamsGalleryRequest, setTeamsGalleryRequest] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)
  const data = useAppData()

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const setRoute = (nextRoute: AppRoute, historyMode: 'push' | 'replace' = 'push') => {
    if (routePath(nextRoute) === routePath(route)) return
    const nextView = nextRoute.view
    if (view === 'scanner' && scannerSessionAtRisk && !window.confirm('Leave the scanner? Screen sharing will stop and all scanned Echo data that has not been approved and saved will be lost.')) return
    setScannerSessionAtRisk(false)
    setRouteState(nextRoute)
    window.history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ route: nextRoute }, '', pathForRoute(nextRoute))
  }
  const setView = (nextView: AppView) => {
    const nextRoute: AppRoute = nextView === 'archive'
      ? { view: nextView, archiveTab: 'characters' }
      : { view: nextView }
    setRoute(nextRoute)
  }
  useEffect(() => {
    const handleHistoryNavigation = () => {
      const nextRoute = routeFromLocation()
      if (view === 'scanner' && nextRoute.view !== 'scanner' && scannerSessionAtRisk && !window.confirm('Leave the scanner? Screen sharing will stop and all scanned Echo data that has not been approved and saved will be lost.')) {
        window.history.pushState({ route }, '', pathForRoute(route))
        return
      }
      setScannerSessionAtRisk(false)
      setRouteState(nextRoute)
    }
    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [route, scannerSessionAtRisk, view])
  useEffect(() => {
    const label = nav.find((item) => item.view === view)?.label ?? (view === 'legal' ? 'Privacy & Legal' : 'Tacet Lab')
    document.title = `${label} | Tacet Lab`
  }, [view])
  const exportData = async () => {
    const account = await exportAccount()
    const blob = new Blob([JSON.stringify(account, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = 'tacet-lab-' + new Date().toISOString().slice(0, 10) + '.json'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000)
    notify('Data exported')
  }
  const restore = async (file?: File) => {
    if (!file) return
    try {
      const document: unknown = JSON.parse(await file.text())
      if (!validateAccount(document)) throw new Error('Unsupported backup format.')
      await importAccount(document)
      await data.refresh()
      notify('Backup restored')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Import failed')
    }
  }
  const savePreferences = async (form: HTMLFormElement) => {
    const values = new FormData(form)
    const scanIntervalMs = Math.min(10_000, Math.max(250, Number(values.get('scanIntervalMs')) || 900))
    await saveSettings({
      ...data.settings,
      displayName: String(values.get('displayName') || 'Resonator'),
      privacyMode: values.get('privacyMode') === 'on',
      background: String(values.get('background')) as typeof data.settings.background,
      roverGender: String(values.get('roverGender')) as typeof data.settings.roverGender,
      scanIntervalMs
    })
    await data.refresh()
    setSettingsOpen(false)
    notify('Preferences saved')
  }

  if (!data.ready) return <div className="boot"><div className="brand-mark"><i/><i/><i/></div><span>INITIALIZING LOCAL ARCHIVE</span></div>
  if (data.error) return <div className="boot"><div className="brand-mark"><i/><i/><i/></div><strong>LOCAL ARCHIVE UNAVAILABLE</strong><span>{data.error}</span><button className="secondary" onClick={() => location.reload()}>Retry</button></div>

  return <div className={`app-shell ${view === 'dashboard' ? 'is-home' : ''}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => setView('dashboard')}><div className="brand-mark"><i/><i/><i/></div><div><strong>TACET LAB</strong><span>WUWA OPTIMIZER</span></div></button>
      <nav>{nav.map((item) => <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => { if (item.view === 'teams') setTeamsGalleryRequest((request) => request + 1); setView(item.view) }}><Icon name={item.icon}/><span>{item.label}</span>{item.view === 'scanner' && <b>EN</b>}</button>)}</nav>
      <div className="side-bottom"><div className="local-status"><i/><div><strong>Local inventory</strong><span>{data.echoes.length} Echoes · {data.characters.length} characters · {data.weapons.length} weapons</span></div></div><button className={view === 'legal' ? 'active' : ''} onClick={() => setView('legal')}><Icon name="lock"/><span>Privacy & Legal</span></button><button onClick={() => setSettingsOpen(true)}><Icon name="settings"/><span>Settings & data</span></button></div>
    </aside>
    <main>
      <div className="topbar"><div className="local-only-status" title="Inventory, builds, settings, and captured frames stay in this browser."><span className="pulse"/><span><strong>LOCAL ONLY</strong><small>Data stays on this device</small></span></div><div><button onClick={() => importRef.current?.click()}><Icon name="upload"/>Import</button><button onClick={exportData}><Icon name="download"/>Export</button><a className="discord-button" href="https://discord.gg/fy66NmapWb" target="_blank" rel="noreferrer" aria-label="Join the Tacet Lab Discord" title="Join the Tacet Lab Discord"><Icon name="discord"/></a><input ref={importRef} hidden type="file" accept="application/json" onChange={(event) => restore(event.target.files?.[0])}/><button className="settings-button" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}><Icon name="settings"/></button></div></div>
      <div className={`content${view === 'teams' ? ' teams-content' : ''}`}>
        <Suspense fallback={<div className="boot view-loading"><div className="brand-mark"><i/><i/><i/></div><span>LOADING WORKSPACE</span></div>}>
          {view === 'dashboard' && <HomeView echoes={data.echoes} characters={data.characters} weapons={data.weapons} builds={data.builds} teams={data.teams} navigate={setView}/>}
          {view === 'archive' && <ArchiveView roverGender={data.settings.roverGender} tab={route.archiveTab ?? 'characters'} onTabChange={(archiveTab) => setRoute({ view: 'archive', archiveTab })}/>}
          {view === 'scanner' && <ScannerView echoes={data.echoes} refresh={data.refresh} scanIntervalMs={data.settings.scanIntervalMs} onSessionRiskChange={setScannerSessionAtRisk}/>}
          {view === 'echoes' && <InventoryView echoes={data.echoes} builds={data.builds} refresh={data.refresh} openScanner={() => setView('scanner')}/>}
          {view === 'weapons' && <><PageHeader eyebrow="Local collection" title="Weapons" description="Manage every weapon copy stored in this browser."/><WeaponInventory owned={data.weapons} characters={data.characters} builds={data.builds} refresh={data.refresh}/></>}
          {view === 'characters' && <><PageHeader eyebrow="Local roster" title="Characters" description="Open a character to inspect their loadout and team links."/><CharacterInventory owned={data.characters} weapons={data.weapons} echoes={data.echoes} builds={data.builds} teams={data.teams} settings={data.settings} roverGender={data.settings.roverGender} refresh={data.refresh} characterIdentifier={route.character} onCharacterChange={(entry) => setRoute({ view: 'characters', character: entry ? characterSlug(entry.name) : undefined })}/></>}
          {view === 'teams' && <TeamsView echoes={data.echoes} builds={data.builds} teams={data.teams} characters={data.characters} weapons={data.weapons} refresh={data.refresh} openScanner={() => setView('scanner')} galleryRequest={teamsGalleryRequest} roverGender={data.settings.roverGender} route={{ team: route.team, character: route.teamCharacter, section: route.teamSection }} onRouteChange={(next) => setRoute({ view: 'teams', team: next.team, teamCharacter: next.character, teamSection: next.section })}/>}
          {view === 'legal' && <PrivacyLegalView/>}
        </Suspense>
      </div>
      <footer className="site-footer"><span>This is an independent fan project not affiliated with/endorsed by Wuthering Waves or Kuro Games.</span><span>Catalog data: Nanoka 3.5</span></footer>
    </main>
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><Panel className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="section-heading"><div><span className="eyebrow">Local preferences</span><h2>Settings & data</h2></div><button className="close" onClick={() => setSettingsOpen(false)}>×</button></div>
      <form onSubmit={(event) => { event.preventDefault(); void savePreferences(event.currentTarget) }}>
        <label>Build-card display name<input name="displayName" defaultValue={data.settings.displayName}/></label>
        <label>Rover appearance<select name="roverGender" defaultValue={data.settings.roverGender}><option value="male">Male Rover</option><option value="female">Female Rover</option></select></label>
        <label>Exported build-card background<select name="background" defaultValue={data.settings.background}><option value="signal">Signal grid</option><option value="tacet">Tacet bloom</option><option value="plain">Plain black</option></select><small>Changes the decorative background used when viewing or exporting build cards.</small></label>
        <label>Stable-frame interval (ms)<input name="scanIntervalMs" type="number" min="250" max="10000" step="50" defaultValue={data.settings.scanIntervalMs}/></label>
        <label className="check"><input name="privacyMode" type="checkbox" defaultChecked={data.settings.privacyMode}/>Hide display name on exported cards</label>
        <div className="modal-actions"><button type="button" className="danger text" onClick={async () => { if (confirm('Delete all local Echoes, characters, weapons, builds, teams, and settings?')) { await clearAccount(); await data.refresh(); setSettingsOpen(false); notify('Local data cleared') } }}>Delete local data</button><button className="primary" type="submit">Save preferences</button></div>
      </form>
    </Panel></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>
}

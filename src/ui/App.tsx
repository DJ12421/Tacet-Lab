import { useEffect, useState } from 'react'
import type { AppView } from '../domain/types'
import { clearAccount, exportAccount, saveSettings } from '../storage/database'
import { ArchiveView } from './ArchiveView'
import { CharacterInventory } from './CharacterInventoryView'
import { HomeView } from './HomeView'
import { ImportDataModal } from './ImportDataModal'
import { InventoryView } from './InventoryView'
import { WeaponInventory } from './OwnedInventoryView'
import { Icon, PageHeader, Panel } from './primitives'
import { PrivacyLegalView } from './PrivacyLegalView'
import { PwaUpdatePrompt } from './PwaUpdatePrompt'
import { ScannerView } from './ScannerView'
import { TeamsView } from './TeamsView'
import { useAppData } from './useAppData'

const sidebarIconRoot = `${import.meta.env.BASE_URL}sidebar-icons/`
const nav: Array<{ view: AppView; label: string; icon?: string; legacyIcon?: Parameters<typeof Icon>[0]['name'] }> = [
  { view: 'dashboard', label: 'Home', icon: 'home.svg' },
  { view: 'archive', label: 'Archive', icon: 'archive.svg' },
  { view: 'echoes', label: 'Echoes', icon: 'echoes.svg' },
  { view: 'weapons', label: 'Weapons', icon: 'weapons.svg' },
  { view: 'characters', label: 'Characters', icon: 'characters.svg' },
  { view: 'teams', label: 'Teams', legacyIcon: 'team' },
  { view: 'scanner', label: 'Scanner', legacyIcon: 'scan' }
]
const sidebarPinStorageKey = 'tacet-lab-sidebar-pinned'

const viewPaths: Record<AppView, string> = {
  dashboard: 'home',
  archive: 'archive',
  scanner: 'scanner',
  echoes: 'echoes',
  weapons: 'weapons',
  characters: 'characters',
  teams: 'teams',
  legal: 'privacy'
}
type ArchiveTab = 'characters' | 'weapons' | 'sonatas' | 'echoes'
type TeamSection = 'overview' | 'forte' | 'optimize' | 'rotation'
interface AppRoute {
  view: AppView
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
  const [importOpen, setImportOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [scannerSessionAtRisk, setScannerSessionAtRisk] = useState(false)
  const [teamsGalleryRequest, setTeamsGalleryRequest] = useState(0)
  const [navigationVersion, setNavigationVersion] = useState(0)
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try { return window.localStorage.getItem(sidebarPinStorageKey) === 'true' } catch { return false }
  })
  const [sidebarOpenOverride, setSidebarOpenOverride] = useState<boolean | null>(null)
  const data = useAppData()
  const sidebarOpen = sidebarPinned || (sidebarOpenOverride ?? view === 'dashboard')
  const sidebarReserved = sidebarPinned || (view === 'dashboard' && sidebarOpenOverride !== false)

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const setRoute = (nextRoute: AppRoute, historyMode: 'push' | 'replace' = 'push') => {
    if (routePath(nextRoute) === routePath(route)) return
    const nextView = nextRoute.view
    if (view === 'scanner' && scannerSessionAtRisk && !window.confirm('Leave the scanner? Screen sharing will stop and all scanned Echo data that has not been approved and saved will be lost.')) return
    setScannerSessionAtRisk(false)
    setRouteState(nextRoute)
    window.history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ route: nextRoute }, '', pathForRoute(nextRoute))
    setNavigationVersion((version) => version + 1)
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
      setNavigationVersion((version) => version + 1)
    }
    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [route, scannerSessionAtRisk, view])
  useEffect(() => {
    const label = nav.find((item) => item.view === view)?.label ?? (view === 'legal' ? 'Privacy & Legal' : 'Tacet Lab')
    document.title = `${label} | Tacet Lab`
  }, [view])
  useEffect(() => {
    try { window.localStorage.setItem(sidebarPinStorageKey, String(sidebarPinned)) } catch { /* Keep the preference session-only when storage is unavailable. */ }
  }, [sidebarPinned])
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
  const savePreferences = async (form: HTMLFormElement) => {
    const values = new FormData(form)
    await saveSettings({
      ...data.settings,
      displayName: String(values.get('displayName') || 'Resonator').trim() || 'Resonator',
      uid: String(values.get('uid') || '').trim(),
      roverGender: String(values.get('roverGender')) as typeof data.settings.roverGender
    })
    await data.refresh()
    setSettingsOpen(false)
    notify('Preferences saved')
  }

  if (!data.ready) return <div className="boot"><div className="brand-mark"><i/><i/><i/></div><span>INITIALIZING LOCAL ARCHIVE</span></div>
  if (data.error) return <div className="boot"><div className="brand-mark"><i/><i/><i/></div><strong>LOCAL ARCHIVE UNAVAILABLE</strong><span>{data.error}</span><button className="secondary" onClick={() => location.reload()}>Retry</button></div>

  return <div className={`app-shell ${view === 'dashboard' ? 'is-home' : ''} ${sidebarPinned ? 'sidebar-pinned' : ''} ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarReserved ? 'sidebar-reserved' : ''}`}>
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-controls">
        <span className="sidebar-label">Navigation</span>
        <button className="sidebar-pin" type="button" aria-pressed={sidebarPinned} title={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'} onClick={() => { setSidebarPinned(!sidebarPinned); setSidebarOpenOverride(sidebarPinned ? false : true) }}><svg className="sidebar-pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15.8 3.4 4.8 4.8-2.6 1.3-3.2 3.2.8 3.9-1.5 1.5-4.1-4.1-5.1 5.1-1.2-1.2 5.1-5.1-4.1-4.1 1.5-1.5 3.9.8 3.2-3.2 1.3-2.6Z"/></svg><span>{sidebarPinned ? 'Unpin' : 'Pin'}</span></button>
      </div>
      <button className="brand" onClick={() => setView('dashboard')}><div className="brand-mark"><i/><i/><i/></div><div><strong>TACET LAB</strong><span>WUWA OPTIMIZER</span></div></button>
      <nav>{nav.map((item) => <button key={item.view} title={item.label} className={view === item.view ? 'active' : ''} onClick={() => { if (item.view === 'teams') setTeamsGalleryRequest((request) => request + 1); setSidebarOpenOverride(null); setView(item.view) }}>{item.legacyIcon ? <Icon name={item.legacyIcon}/> : <img className="sidebar-nav-icon" src={`${sidebarIconRoot}${item.icon}`} alt=""/>}<span>{item.label}</span>{item.view === 'scanner' && <b>EN</b>}</button>)}</nav>
      <div className="side-bottom"><div className="local-status"><i/><div><strong>Local inventory</strong><span>{data.echoes.length} Echoes · {data.characters.length} characters · {data.weapons.length} weapons</span></div></div><button className={view === 'legal' ? 'active' : ''} onClick={() => setView('legal')}><Icon name="lock"/><span>Privacy & Legal</span></button><button onClick={() => setSettingsOpen(true)}><Icon name="settings"/><span>Settings</span></button></div>
    </aside>
    <main>
      <div className="topbar"><div className="local-only-status" title="Inventory, builds, settings, and captured frames stay in this browser."><span className="pulse"/><span><strong>LOCAL ONLY</strong><small>Data stays on this device</small></span></div><div><button onClick={() => setImportOpen(true)}><Icon name="upload"/>Import</button><button onClick={exportData}><Icon name="download"/>Export</button><a className="discord-button" href="https://discord.gg/fy66NmapWb" target="_blank" rel="noreferrer" aria-label="Join the Tacet Lab Discord" title="Join the Tacet Lab Discord"><Icon name="discord"/></a></div></div>
      <div className={`content${view === 'teams' ? ' teams-content' : ''}`}>
        {view === 'dashboard' && <HomeView echoes={data.echoes} characters={data.characters} weapons={data.weapons} builds={data.builds} teams={data.teams} navigate={setView}/>}
        {view === 'archive' && <ArchiveView roverGender={data.settings.roverGender} tab={route.archiveTab ?? 'characters'} onTabChange={(archiveTab) => setRoute({ view: 'archive', archiveTab })}/>}
        {view === 'scanner' && <ScannerView echoes={data.echoes} refresh={data.refresh} scanIntervalMs={data.settings.scanIntervalMs} onScanIntervalChange={async (scanIntervalMs) => { await saveSettings({ ...data.settings, scanIntervalMs }); await data.refresh(); notify('Scan speed saved') }} onSessionRiskChange={setScannerSessionAtRisk}/>}
        {view === 'echoes' && <InventoryView echoes={data.echoes} builds={data.builds} refresh={data.refresh} openScanner={() => setView('scanner')}/>}
        {view === 'weapons' && <WeaponInventory owned={data.weapons} characters={data.characters} builds={data.builds} refresh={data.refresh} weaponIdentifier={route.weapon} onWeaponChange={(weapon) => setRoute({ view: 'weapons', weapon: weapon?.id })}/>}
        {view === 'characters' && <CharacterInventory owned={data.characters} weapons={data.weapons} echoes={data.echoes} builds={data.builds} equippedLoadouts={data.equippedLoadouts} theorycraftBuilds={data.theorycraftBuilds} teams={data.teams} settings={data.settings} roverGender={data.settings.roverGender} refresh={data.refresh} characterIdentifier={route.character} onCharacterChange={(entry) => setRoute({ view: 'characters', character: entry ? characterSlug(entry.name) : undefined })}/>} 
        {view === 'teams' && <TeamsView echoes={data.echoes} builds={data.builds} equippedLoadouts={data.equippedLoadouts} theorycraftBuilds={data.theorycraftBuilds} teams={data.teams} characters={data.characters} weapons={data.weapons} refresh={data.refresh} openScanner={() => setView('scanner')} galleryRequest={teamsGalleryRequest} roverGender={data.settings.roverGender} route={{ team: route.team, character: route.teamCharacter, section: route.teamSection }} onRouteChange={(next) => setRoute({ view: 'teams', team: next.team, teamCharacter: next.character, teamSection: next.section })}/>} 
        {view === 'legal' && <PrivacyLegalView/>}
      </div>
      <footer className="site-footer"><span>This is an independent fan project not affiliated with/endorsed by Wuthering Waves or Kuro Games.</span><span>Catalog data: Nanoka 3.6</span></footer>
    </main>
    {importOpen && <ImportDataModal onClose={() => setImportOpen(false)} onImported={async (preview) => { await data.refresh(); notify(`Import merged: ${preview.added} new, ${preview.updated} updated, ${preview.duplicates} duplicates skipped`) }}/>} 
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><Panel className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="settings-header"><div><span className="eyebrow">Make it yours</span><h2>Settings</h2></div><button className="close" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></div>
      <form onSubmit={(event) => { event.preventDefault(); void savePreferences(event.currentTarget) }}>
        <section className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon">◇</span><div><strong>Rover</strong><small>Used anywhere Rover appears.</small></div></div>
          <div className="settings-choice" role="radiogroup" aria-label="Rover appearance">
            <label><input type="radio" name="roverGender" value="male" defaultChecked={data.settings.roverGender === 'male'}/><span><b>Male Rover</b><small>Use the male artwork</small></span></label>
            <label><input type="radio" name="roverGender" value="female" defaultChecked={data.settings.roverGender === 'female'}/><span><b>Female Rover</b><small>Use the female artwork</small></span></label>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Icon name="build"/></span><div><strong>Build cards</strong><small>Applied to exported character cards.</small></div></div>
          <label className="settings-name-field"><span>Display name</span><input name="displayName" maxLength={40} defaultValue={data.settings.displayName} placeholder="Resonator"/></label>
          <label className="settings-name-field"><span>User UID</span><input name="uid" inputMode="numeric" maxLength={20} defaultValue={data.settings.uid} placeholder="Enter your in-game UID"/></label>
        </section>
        <section className="settings-section settings-data-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Icon name="lock"/></span><div><strong>Your data</strong><small>Stored only in this browser.</small></div></div>
          <div className="settings-data-actions"><button type="button" className="secondary" onClick={() => { setSettingsOpen(false); setImportOpen(true) }}><Icon name="upload"/><span>Import</span></button><button type="button" className="secondary" onClick={() => void exportData()}><Icon name="download"/><span>Export</span></button></div>
          <button type="button" className="danger text settings-delete" onClick={async () => { if (confirm('Delete all local Echoes, characters, weapons, builds, teams, and settings?')) { await clearAccount(); await data.refresh(); setSettingsOpen(false); notify('Local data cleared') } }}>Delete all local data</button>
        </section>
        <div className="settings-save"><button className="primary" type="submit">Save changes</button></div>
      </form>
    </Panel></div>}
    {toast && <div className="toast">{toast}</div>}
    <PwaUpdatePrompt safeToActivate={!scannerSessionAtRisk && !importOpen && !settingsOpen} navigationVersion={navigationVersion}/>
  </div>
}

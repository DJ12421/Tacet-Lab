import { lazy, Suspense, useRef, useState } from 'react'
import type { AppView } from '../domain/types'
import { clearAccount, exportAccount, importAccount, saveSettings, validateAccount } from '../storage/database'
import { Icon, PageHeader, Panel } from './primitives'
import { useAppData } from './useAppData'

const ArchiveView = lazy(() => import('./ArchiveView').then((module) => ({ default: module.ArchiveView })))
const CharacterInventory = lazy(() => import('./CharacterInventoryView').then((module) => ({ default: module.CharacterInventory })))
const HomeView = lazy(() => import('./HomeView').then((module) => ({ default: module.HomeView })))
const InventoryView = lazy(() => import('./InventoryView').then((module) => ({ default: module.InventoryView })))
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

export default function App() {
  const [view, setViewState] = useState<AppView>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [scannerSessionAtRisk, setScannerSessionAtRisk] = useState(false)
  const [teamsGalleryRequest, setTeamsGalleryRequest] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)
  const data = useAppData()

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const setView = (nextView: AppView) => {
    if (nextView === view) return
    if (view === 'scanner' && scannerSessionAtRisk && !window.confirm('Leave the scanner? Screen sharing will stop and all scanned Echo data that has not been approved and saved will be lost.')) return
    setScannerSessionAtRisk(false)
    setViewState(nextView)
  }
  const backup = async () => {
    const account = await exportAccount()
    const blob = new Blob([JSON.stringify(account, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = 'tacet-lab-' + new Date().toISOString().slice(0, 10) + '.json'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000)
    notify('Backup exported')
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

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setView('dashboard')}><div className="brand-mark"><i/><i/><i/></div><div><strong>TACET LAB</strong><span>WUWA OPTIMIZER</span></div></button>
      <nav>{nav.map((item) => <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => { if (item.view === 'teams') setTeamsGalleryRequest((request) => request + 1); setView(item.view) }}><Icon name={item.icon}/><span>{item.label}</span>{item.view === 'scanner' && <b>EN</b>}</button>)}</nav>
      <div className="side-bottom"><div className="local-status"><i/><div><strong>Local inventory</strong><span>{data.echoes.length} Echoes · {data.characters.length} characters · {data.weapons.length} weapons</span></div></div><button onClick={() => setSettingsOpen(true)}>⚙<span>Settings & data</span></button></div>
    </aside>
    <main>
      <div className="topbar"><div><span className="pulse"/>PRIVATE SESSION</div><div><button onClick={() => importRef.current?.click()}><Icon name="upload"/>Import</button><button onClick={backup}><Icon name="download"/>Backup</button><input ref={importRef} hidden type="file" accept="application/json" onChange={(event) => restore(event.target.files?.[0])}/><button className="user-button" onClick={() => setSettingsOpen(true)}>{data.settings.privacyMode ? 'P' : data.settings.displayName[0]?.toUpperCase()}</button></div></div>
      <div className={`content${view === 'teams' ? ' teams-content' : ''}`}>
        <Suspense fallback={<div className="boot view-loading"><div className="brand-mark"><i/><i/><i/></div><span>LOADING WORKSPACE</span></div>}>
          {view === 'dashboard' && <HomeView echoes={data.echoes} characters={data.characters} weapons={data.weapons} builds={data.builds} teams={data.teams} navigate={setView}/>}
          {view === 'archive' && <ArchiveView roverGender={data.settings.roverGender}/>}
          {view === 'scanner' && <ScannerView echoes={data.echoes} refresh={data.refresh} scanIntervalMs={data.settings.scanIntervalMs} onSessionRiskChange={setScannerSessionAtRisk}/>}
          {view === 'echoes' && <InventoryView echoes={data.echoes} builds={data.builds} refresh={data.refresh} openScanner={() => setView('scanner')}/>}
          {view === 'weapons' && <><PageHeader eyebrow="Local collection" title="Weapons" description="Manage every weapon copy stored in this browser."/><WeaponInventory owned={data.weapons} characters={data.characters} builds={data.builds} refresh={data.refresh}/></>}
          {view === 'characters' && <><PageHeader eyebrow="Local roster" title="Characters" description="Open a character to inspect their loadout and team links."/><CharacterInventory owned={data.characters} weapons={data.weapons} echoes={data.echoes} builds={data.builds} teams={data.teams} roverGender={data.settings.roverGender} refresh={data.refresh}/></>}
          {view === 'teams' && <TeamsView echoes={data.echoes} builds={data.builds} teams={data.teams} characters={data.characters} weapons={data.weapons} refresh={data.refresh} openScanner={() => setView('scanner')} galleryRequest={teamsGalleryRequest}/>}
        </Suspense>
      </div>
      <footer className="site-footer"><span>Fan-made tool. Not affiliated with Kuro Games.</span><span>Catalog data: Nanoka 3.5</span></footer>
    </main>
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><Panel className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="section-heading"><div><span className="eyebrow">Local preferences</span><h2>Settings & data</h2></div><button className="close" onClick={() => setSettingsOpen(false)}>×</button></div>
      <form onSubmit={(event) => { event.preventDefault(); void savePreferences(event.currentTarget) }}>
        <label>Build-card display name<input name="displayName" defaultValue={data.settings.displayName}/></label>
        <label>Rover appearance<select name="roverGender" defaultValue={data.settings.roverGender}><option value="male">Male Rover</option><option value="female">Female Rover</option></select></label>
        <label>Card atmosphere<select name="background" defaultValue={data.settings.background}><option value="signal">Signal grid</option><option value="tacet">Tacet bloom</option><option value="plain">Plain black</option></select></label>
        <label>Stable-frame interval (ms)<input name="scanIntervalMs" type="number" min="250" max="10000" step="50" defaultValue={data.settings.scanIntervalMs}/></label>
        <label className="check"><input name="privacyMode" type="checkbox" defaultChecked={data.settings.privacyMode}/>Hide display name on exported cards</label>
        <div className="modal-actions"><button type="button" className="danger text" onClick={async () => { if (confirm('Delete all local Echoes, characters, weapons, builds, teams, and settings?')) { await clearAccount(); await data.refresh(); setSettingsOpen(false); notify('Local data cleared') } }}>Delete local data</button><button className="primary" type="submit">Save preferences</button></div>
      </form>
    </Panel></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>
}

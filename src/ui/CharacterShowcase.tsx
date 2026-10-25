import { useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { toCanvas, toPng } from 'html-to-image'
import { embedCardMetadata, type CardMetadata } from '../scanner/card-metadata'
import { baseTuneBreakBoost, characterCatalog, echoCatalog, sonataNames, statLabels, weaponCatalog, type CharacterCatalogEntry, type WeaponCatalogEntry } from '../game-data'
import { pendingMechanics } from '../game-data/review-status.generated'
import { characterSubstatScoreKeys } from '../game-data/character-substat-preferences'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { effectiveSubStats } from '../game-data/echo-main-stats'
import { echoRollRating } from '../domain/echo-grade'
import { resolveCharacterSubstatProfile, scoreCharacterSubstats } from '../domain/character-substat-score'
import { setEchoSlot as assignEchoSlot } from '../domain/echo-slots'
import { createLocalId } from '../domain/id'
import { resolveLoadout, type LoadoutCollections } from '../domain/loadouts'
import { db, repairEchoAssignmentConsistency, saveSettings, setOwnedWeaponOwner } from '../storage/database'
import { deleteCharacterArtwork, loadCharacterArtwork, saveCharacterArtwork } from '../storage/character-art-cache'
import { equipSavedBuild, setEquippedEchoIds } from '../storage/loadouts'
import type { AppSettings, Build, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, StatKey, TheorycraftBuild } from '../domain/types'
import { CharacterSubstatProfileContext, EchoMiniCard, FilterChips, Icon, Panel, SingleSelect } from './components'
import { EchoEditModal } from './EchoEditModal'
import type { AnimatedCharacterPortraitHandle } from './AnimatedCharacterPortrait'
import type { CalculationDetail } from './CalculationDetails'
import { showcaseStatDetail } from './calculation-detail-model'
import { CharacterBuildCard, prioritizedBuildCardStats, type BuildCardStatKey } from './CharacterBuildCard'
import { defaultEnabledSkillTreeBonusIds, inherentSkillBonusId, resolveCharacterShowcaseModel, skillTreeBonusId } from './character-showcase-model'
import { WeaponInventoryCard, weaponBuildCharacterIds, weaponBuildLabels } from './WeaponInventoryCard'
import { MultiSelect } from './InventoryView'
import { statIconSource } from './stat-icons'
import { confirmDiscardChanges, useUnsavedChanges } from './useUnsavedChanges'
import { BoundedNumberInput } from './BoundedNumberInput'
import './character-showcase.css'

function customAccentStyle(color: string | null): CSSProperties | undefined {
  if (!color) return undefined
  const value = color.slice(1)
  const rgb = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) => Number.parseInt(part, 16)).join(',')
  return { '--cs-accent': color, '--cs-accent-rgb': rgb } as CSSProperties
}

interface CharacterShowcaseProps {
  character: OwnedCharacter
  characters: OwnedCharacter[]
  catalog: CharacterCatalogEntry
  weapons: OwnedWeapon[]
  echoes: Echo[]
  builds: Build[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  settings: AppSettings
  refresh: () => Promise<void>
  onBack: () => void
}

function Stars({ rarity }: { rarity: number }) {
  return <span className="cs-stars" aria-label={`${rarity} star rarity`}>{'★'.repeat(rarity)}</span>
}

async function inlineImageSource(image: HTMLImageElement) {
  const source = image.currentSrc || image.src
  if (!source || source.startsWith('data:')) return
  const response = await fetch(source, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Image request failed with ${response.status}`)
  const blob = await response.blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  image.src = dataUrl
  await image.decode()
  return source
}

const EXPORT_CARD_WIDTH = 1920
const EXPORT_CARD_HEIGHT = 1080
const EXPORT_BACKDROP_BLUR = 12
const EXPORT_GLASS_SELECTOR = '.cbc-glass,.cbc-echo-row,.cbc-sonatas button'

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

const exportRenderOptions = {
  width: EXPORT_CARD_WIDTH,
  height: EXPORT_CARD_HEIGHT,
  pixelRatio: 1,
  cacheBust: true,
  backgroundColor: '#030708',
  style: { width: `${EXPORT_CARD_WIDTH}px`, height: `${EXPORT_CARD_HEIGHT}px`, maxWidth: 'none', transform: 'none' }
}

function renderExportFrame(frame: HTMLElement) { return toPng(frame, exportRenderOptions) }

async function bakeExportGlassBackdrops(exportFrame: HTMLDivElement) {
  const host = exportFrame.parentElement
  if (!host) return

  const backgroundFrame = exportFrame.cloneNode(true) as HTMLDivElement
  backgroundFrame.classList.add('is-exporting-background')
  host.append(backgroundFrame)
  const snapshot = backgroundFrame.querySelector<HTMLImageElement>('.cbc-live-portrait-snapshot')
  if (snapshot?.src) await snapshot.decode().catch(() => undefined)
  await nextPaint()

  let backgroundCanvas: HTMLCanvasElement
  try {
    backgroundCanvas = await toCanvas(backgroundFrame, exportRenderOptions)
  } finally {
    backgroundFrame.remove()
  }

  const padding = EXPORT_BACKDROP_BLUR * 3
  const blurred = document.createElement('canvas')
  blurred.width = EXPORT_CARD_WIDTH + padding * 2
  blurred.height = EXPORT_CARD_HEIGHT + padding * 2
  const blurContext = blurred.getContext('2d')
  if (!blurContext) return
  blurContext.filter = `blur(${EXPORT_BACKDROP_BLUR}px)`
  blurContext.drawImage(backgroundCanvas, padding, padding, EXPORT_CARD_WIDTH, EXPORT_CARD_HEIGHT)
  backgroundCanvas.width = 0; backgroundCanvas.height = 0

  const frameBounds = exportFrame.getBoundingClientRect()
  if (!frameBounds.width || !frameBounds.height) { blurred.width = 0; blurred.height = 0; return }
  const scaleX = EXPORT_CARD_WIDTH / frameBounds.width
  const scaleY = EXPORT_CARD_HEIGHT / frameBounds.height
  for (const panel of exportFrame.querySelectorAll<HTMLElement>(EXPORT_GLASS_SELECTOR)) {
    const bounds = panel.getBoundingClientRect()
    const x = Math.round((bounds.left - frameBounds.left) * scaleX)
    const y = Math.round((bounds.top - frameBounds.top) * scaleY)
    const width = Math.max(1, Math.round(bounds.width * scaleX))
    const height = Math.max(1, Math.round(bounds.height * scaleY))
    const crop = document.createElement('canvas')
    crop.width = width
    crop.height = height
    const cropContext = crop.getContext('2d')
    if (!cropContext) continue
    cropContext.drawImage(blurred, x + padding, y + padding, width, height, 0, 0, width, height)
    const cropImage = crop.toDataURL('image/png')
    crop.width = 0; crop.height = 0
    panel.style.setProperty('--cbc-export-backdrop-image', `url("${cropImage}")`)
    panel.classList.add('has-export-backdrop')
  }
  blurred.width = 0; blurred.height = 0
}

export function richSkillDescription(description: string) {
  const nodes: ReactNode[] = []
  const colors: string[] = []
  const sizes: string[] = []
  const tokens = description.replace(/\{Cus:[^}]*\}/g, '').split(/(<[^>]+>)/g)
  tokens.forEach((token, index) => {
    const colorOpen = token.match(/^<color=([^>]+)>$/i)
    const sizeOpen = token.match(/^<size=([^>]+)>$/i)
    if (colorOpen) { colors.push(colorOpen[1].toLowerCase()); return }
    if (sizeOpen) { sizes.push(sizeOpen[1]); return }
    if (/^<\/color>$/i.test(token)) { colors.pop(); return }
    if (/^<\/size>$/i.test(token)) { sizes.pop(); return }
    if (/^<[^>]+>$/.test(token) || !token) return
    const color = colors.at(-1)?.replace(/[^a-z0-9_-]/g, '')
    const isHeading = Number(sizes.at(-1) ?? 0) >= 30
    nodes.push(<span className={`${color ? `cs-rich-${color}` : ''} ${isHeading ? 'cs-rich-heading' : ''}`.trim()} key={`${index}-${token.slice(0, 12)}`}>{token}</span>)
  })
  return nodes
}

const pickerPreferencesKey = (characterId: string) => `tacet-lab-character-card-pickers:${characterId}`
const weaponRarities = [5, 4, 3, 2, 1]

function readPickerPreferences(characterId: string, menu: 'weapon' | 'echo'): Record<string, unknown> {
  try {
    const value = JSON.parse(window.localStorage.getItem(pickerPreferencesKey(characterId)) ?? 'null')
    return value && typeof value === 'object' && value[menu] && typeof value[menu] === 'object' ? value[menu] : {}
  } catch { return {} }
}

function savePickerPreferences(characterId: string, menu: 'weapon' | 'echo', preferences: Record<string, unknown>) {
  try {
    const value = JSON.parse(window.localStorage.getItem(pickerPreferencesKey(characterId)) ?? 'null')
    const current = value && typeof value === 'object' ? value : {}
    window.localStorage.setItem(pickerPreferencesKey(characterId), JSON.stringify({ ...current, [menu]: preferences }))
  } catch { /* Storage may be unavailable; the current menu remains usable. */ }
}

function savedSelection<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T[]): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => allowed.includes(item as T)) : fallback
}

function WeaponPicker({ character, characters, catalog, weapons, builds, equippedLoadouts, refresh, onClose }: { character: OwnedCharacter; characters: OwnedCharacter[]; catalog: CharacterCatalogEntry; weapons: OwnedWeapon[]; builds: Build[]; equippedLoadouts: EquippedLoadout[]; refresh: () => Promise<void>; onClose: () => void }) {
  const preferences = useMemo(() => readPickerPreferences(character.id, 'weapon'), [character.id])
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState(() => typeof preferences.query === 'string' ? preferences.query : '')
  const [rarities, setRarities] = useState(() => savedSelection(preferences.rarities, weaponRarities, weaponRarities))
  useEffect(() => savePickerPreferences(character.id, 'weapon', { query, rarities }), [character.id, query, rarities])
  const eligibleOwned = weapons.flatMap((owned) => {
    const entry = weaponCatalog.find((candidate) => candidate.id === owned.catalogId)
    return entry?.type.toLowerCase() === catalog.weaponType.toLowerCase() ? [{ owned, entry }] : []
  })
  const eligibleCatalog = weaponCatalog.filter((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())
  const matches = (entry: WeaponCatalogEntry) => rarities.includes(entry.rarity) && entry.name.toLowerCase().includes(query.trim().toLowerCase())
  const visibleOwned = eligibleOwned.filter(({ entry }) => matches(entry)).sort((left, right) => right.entry.rarity - left.entry.rarity || left.entry.name.localeCompare(right.entry.name))
  const buildLabels = weaponBuildLabels(builds, characters)
  const buildCharacterIds = weaponBuildCharacterIds(builds, characters)
  const equippedWeaponOwners = new Map<string, string>()
  for (const loadout of equippedLoadouts) if (loadout.weaponId) equippedWeaponOwners.set(loadout.weaponId, loadout.characterId)
  const visibleCatalog = eligibleCatalog.filter(matches).sort((left, right) => right.rarity - left.rarity || left.name.localeCompare(right.name))
  const equip = async (weapon: OwnedWeapon) => {
    await setOwnedWeaponOwner(weapon.id, character.id)
    await refresh()
    onClose()
  }
  const add = async (entry: WeaponCatalogEntry) => {
    const weapon: OwnedWeapon = { id: createLocalId(), catalogId: entry.id, level: 1, rank: 1, locked: false, createdAt: Date.now() }
    await db.weapons.add(weapon)
    await equip(weapon)
  }
  return createPortal(<div className={`catalog-picker-backdrop cs-picker-backdrop cs-element-${catalog.element.toLowerCase()}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="catalog-picker cs-picker cs-weapon-picker" role="dialog" aria-modal="true" aria-label="Equip weapon"><header><div><span className="eyebrow">{catalog.weaponType} inventory</span><h2>{adding ? 'Add and equip weapon' : 'Equip weapon'}</h2></div><button type="button" className="close" aria-label="Close weapon picker" onClick={onClose}>×</button></header>
    <div className="cs-weapon-picker-toolbar wv-toolbar"><label className="search search-field"><Icon name="scan"/><input data-search="" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a weapon"/><span className="search-count" aria-live="polite">{adding ? visibleCatalog.length : visibleOwned.length}/{adding ? eligibleCatalog.length : eligibleOwned.length}</span><kbd>Ctrl K</kbd></label><FilterChips label="Rarity" hideLabel values={weaponRarities} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/>{adding ? <button type="button" className="secondary" onClick={() => setAdding(false)}>← Owned weapons</button> : <button type="button" className="primary" onClick={() => setAdding(true)}><Icon name="plus"/>Add weapon</button>}</div>
    <div className={adding ? 'catalog-picker-grid cs-weapon-picker-grid' : 'wv-grid cs-weapon-picker-grid'}>
    {!adding && visibleOwned.map(({ owned, entry }) => { const owner = characters.find((candidate) => candidate.id === equippedWeaponOwners.get(owned.id)); const ownerCatalog = characterCatalog.find((candidate) => candidate.id === owner?.catalogId); const buildLabel = buildLabels.get(owned.id)?.join(', '); const referenced = characters.filter((candidate) => candidate.id === owner?.id || buildCharacterIds.get(owned.id)?.includes(candidate.id)).flatMap((candidate) => { const catalog = characterCatalog.find((entry) => entry.id === candidate.catalogId); return catalog ? [{ id: candidate.id, catalog }] : [] }); const shared = referenced.length > 1; const displayName = shared ? referenced.map(({ catalog }) => catalog.name).join(', ') : buildLabel ?? ownerCatalog?.name ?? 'Unequipped'; return <WeaponInventoryCard weapon={owned} catalog={entry} className="cs-weapon-picker-card" ariaLabel={`Equip ${entry.name}`} onClick={() => void equip(owned)} footer={<button type="button" className={`character-equip-trigger cs-weapon-picker-owner${shared ? ' multiple-characters' : buildLabel && !ownerCatalog ? ' no-character-icon' : ''}`} title={displayName} onClick={() => void equip(owned)}>{shared ? <span className="character-owner-stack" aria-hidden="true">{referenced.map(({ id, catalog }) => <img src={catalog.iconSourceUrl} alt="" key={id}/>)}</span> : ownerCatalog ? <img src={ownerCatalog.iconSourceUrl} alt=""/> : !buildLabel && <span className="equip-empty">—</span>}<b>{displayName}</b><i>Equip</i></button>} key={owned.id}/> })}
    {adding && visibleCatalog.map((entry) => <button className={`catalog-choice weapon-choice rarity-${entry.rarity}`} key={entry.id} onClick={() => void add(entry)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>{entry.type}</small><Stars rarity={entry.rarity}/></span></button>)}
    {(adding ? visibleCatalog.length : visibleOwned.length) === 0 && <div className="wv-empty compact"><h3>No matching weapons</h3><button type="button" className="text-button" onClick={() => { setQuery(''); setRarities(weaponRarities) }}>Clear filters</button></div>}
  </div></section></div>, document.body)
}

const echoCostOptions = [1, 3, 4]
const echoRarityOptions = [5, 4, 3, 2]

export function EchoPicker({ slot, characterId, currentIds, echoes, accentClass, refresh, onClose, onSelect }: { slot: number; characterId: string; currentIds: string[]; echoes: Echo[]; accentClass: string; refresh: () => Promise<void>; onClose: () => void; onSelect?: (echoIds: string[], next?: Echo) => Promise<boolean | void> }) {
  const pageSize = 30
  const preferences = useMemo(() => readPickerPreferences(characterId, 'echo'), [characterId])
  const statKeys = Object.keys(statLabels) as StatKey[]
  const [editingEcho, setEditingEcho] = useState<Echo | null>(null)
  const characterSubstatProfile = useContext(CharacterSubstatProfileContext)
  const currentId = currentIds[slot]
  const [query, setQuery] = useState(() => typeof preferences.query === 'string' ? preferences.query : '')
  const [costs, setCosts] = useState(() => savedSelection(preferences.costs, echoCostOptions, echoCostOptions))
  const [rarities, setRarities] = useState(() => savedSelection(preferences.rarities, echoRarityOptions, echoRarityOptions))
  const [sonatas, setSonatas] = useState(() => savedSelection(preferences.sonatas, sonataNames, []))
  const [mainStats, setMainStats] = useState(() => savedSelection(preferences.mainStats, statKeys, []))
  const [subStats, setSubStats] = useState(() => savedSelection(preferences.subStats, statKeys, []))
  const [lockState, setLockState] = useState<'all' | 'locked' | 'unlocked'>(() => preferences.lockState === 'locked' || preferences.lockState === 'unlocked' ? preferences.lockState : 'all')
  const [assignment, setAssignment] = useState<'all' | 'equipped' | 'unequipped'>(() => preferences.assignment === 'equipped' || preferences.assignment === 'unequipped' ? preferences.assignment : 'all')
  const [showExcluded, setShowExcluded] = useState(preferences.showExcluded === true)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [openMultiFilter, setOpenMultiFilter] = useState<'sonata' | 'mainStat' | 'subStat' | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const listRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  useEffect(() => savePickerPreferences(characterId, 'echo', { query, costs, rarities, sonatas, mainStats, subStats, lockState, assignment, showExcluded }), [characterId, query, costs, rarities, sonatas, mainStats, subStats, lockState, assignment, showExcluded])
  const statIcon = (value: string) => <img src={statIconSource(value as StatKey)} alt=""/>
  const activeFilterCount = Number(costs.length !== echoCostOptions.length) + Number(rarities.length !== echoRarityOptions.length) + Number(sonatas.length > 0) + Number(mainStats.length > 0) + Number(subStats.length > 0) + Number(lockState !== 'all') + Number(assignment !== 'all') + Number(showExcluded)
  const resetFilters = () => { setQuery(''); setCosts(echoCostOptions); setRarities(echoRarityOptions); setSonatas([]); setMainStats([]); setSubStats([]); setLockState('all'); setAssignment('all'); setShowExcluded(false) }
  const echoMeta = useMemo(() => new Map(echoes.map((echo) => {
    const substats = effectiveSubStats(echo)
    return [echo.id, {
      substats,
      rollRating: echoRollRating(echo),
      characterScore: characterSubstatProfile ? scoreCharacterSubstats(echo, characterSubstatProfile).percentage : undefined,
      searchText: `${echo.name} ${echo.sonata} ${statLabels[echo.mainStat.key]} ${substats.map((stat) => statLabels[stat.key]).join(' ')}`.toLowerCase()
    }] as const
  })), [characterSubstatProfile, echoes])
  const options = useMemo(() => echoes.filter((echo) =>
    (showExcluded || !echo.excluded) &&
    costs.includes(echo.cost) &&
    rarities.includes(echo.rarity) &&
    (!sonatas.length || sonatas.includes(echo.sonata)) &&
    (!mainStats.length || mainStats.includes(echo.mainStat.key)) &&
    (!subStats.length || subStats.every((key) => echoMeta.get(echo.id)?.substats.some((stat) => stat.key === key))) &&
    (lockState === 'all' || echo.locked === (lockState === 'locked')) &&
    (assignment === 'all' || Boolean(echo.equippedBy) === (assignment === 'equipped')) &&
    (!deferredQuery || echoMeta.get(echo.id)?.searchText.includes(deferredQuery))
  ).sort((left, right) => {
    if (characterSubstatProfile) {
      return (echoMeta.get(right.id)?.characterScore ?? 0) - (echoMeta.get(left.id)?.characterScore ?? 0)
        || left.name.localeCompare(right.name)
    }
    return (echoMeta.get(right.id)?.rollRating.average ?? 0) - (echoMeta.get(left.id)?.rollRating.average ?? 0) || left.name.localeCompare(right.name)
  }), [assignment, characterSubstatProfile, costs, deferredQuery, echoes, echoMeta, lockState, mainStats, rarities, showExcluded, sonatas, subStats])
  useEffect(() => setPage(1), [assignment, costs, deferredQuery, lockState, mainStats, rarities, showExcluded, sonatas, subStats])
  const pageCount = Math.max(1, Math.ceil(options.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageOptions = options.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const changePage = (next: number) => { setPage(next); listRef.current?.scrollTo({ top: 0 }) }
  const pagination = <nav className="echo-pagination" aria-label="Echo picker pages"><span>{options.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, options.length)} <small>of {options.length}</small></span><div>{pageCount > 1 && <><button type="button" className="echo-page-arrow" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)} aria-label="Previous page">‹</button><label className="echo-page-select"><span className="sr-only">Page</span><select value={currentPage} onChange={(event) => changePage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select><small>/ {pageCount}</small></label><button type="button" className="echo-page-arrow" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)} aria-label="Next page">›</button></>}</div></nav>
  const choose = async (next?: Echo) => {
    setError('')
    try {
      const selectedIds = assignEchoSlot(currentIds, slot, next?.id)
      if (onSelect) {
        if (await onSelect(selectedIds, next) === false) return
      } else await setEquippedEchoIds(characterId, selectedIds)
      await refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Echo could not be switched.')
    }
  }
  return <>{createPortal(<div className={`catalog-picker-backdrop cs-picker-backdrop ${accentClass}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="catalog-picker cs-picker cs-echo-picker echo-inventory-view" role="dialog" aria-modal="true" aria-label={`Equip Echo slot ${slot + 1}`}>
      <header><div><span className="eyebrow">Echo slot {slot + 1}</span><h2>Equip Echo</h2></div><div>{currentId && <button type="button" className="danger" onClick={() => void choose()}>Unequip current Echo</button>}<button type="button" className="close" aria-label="Close Echo picker" onClick={onClose}>×</button></div></header>
      <Panel className="inventory-filter echo-inventory-toolbar cs-echo-picker-filters">
        <div className="echo-toolbar-main">
          <label className="search search-field"><Icon name="scan"/><input data-search="" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Echo, Sonata, or stat..."/><kbd>Ctrl K</kbd></label>
          <div className="echo-quick-filters" aria-label="Quick filters"><button type="button" className={activeFilterCount === 0 && !query ? 'active' : ''} onClick={resetFilters}>All</button><button type="button" className={assignment === 'equipped' ? 'active' : ''} onClick={() => { setAssignment(assignment === 'equipped' ? 'all' : 'equipped'); setLockState('all'); setShowExcluded(false) }}>Equipped</button><button type="button" className={lockState === 'locked' ? 'active' : ''} onClick={() => { setLockState(lockState === 'locked' ? 'all' : 'locked'); setAssignment('all'); setShowExcluded(false) }}><Icon name="lock"/>Locked</button></div>
          <button type="button" className={`echo-filter-toggle${filtersOpen ? ' active' : ''}`} aria-expanded={filtersOpen} onClick={() => { setOpenMultiFilter(null); setFiltersOpen((open) => !open) }}><Icon name="settings"/>Filters{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button>
        </div>
        {filtersOpen && <div className="filter-body echo-filter-drawer">
          <div className="filter-group echo-cost-filter" role="group" aria-label="Cost"><FilterChips label="Cost" hideLabel values={echoCostOptions} selected={costs} onChange={setCosts} renderValue={(value) => `${value} cost`}/></div>
          <div className="filter-group echo-rarity-filter" role="group" aria-label="Rarity"><FilterChips label="Rarity" hideLabel values={echoRarityOptions} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/></div>
          <MultiSelect label="Sonata" hideLabel values={sonatas} options={sonataNames.map((name) => ({ value: name, label: name }))} emptyLabel="All Sonatas" onChange={setSonatas} icon={(name) => <img src={generatedSonataIconSources[name]} alt=""/>} open={openMultiFilter === 'sonata'} onToggle={() => setOpenMultiFilter((current) => current === 'sonata' ? null : 'sonata')}/>
          <MultiSelect label="Main stat" hideLabel values={mainStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any main stat" onChange={setMainStats} icon={statIcon} open={openMultiFilter === 'mainStat'} onToggle={() => setOpenMultiFilter((current) => current === 'mainStat' ? null : 'mainStat')}/>
          <MultiSelect label="Substat" hideLabel values={subStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any substat" onChange={setSubStats} icon={statIcon} open={openMultiFilter === 'subStat'} onToggle={() => setOpenMultiFilter((current) => current === 'subStat' ? null : 'subStat')}/>
          <div className="echo-single-filter"><SingleSelect label="Lock state" value={lockState} options={[{ value: 'all', label: 'All' }, { value: 'locked', label: 'Locked' }, { value: 'unlocked', label: 'Unlocked' }]} onChange={(value) => setLockState(value as typeof lockState)}/></div>
          <div className="echo-single-filter"><SingleSelect label="Equipped" value={assignment} options={[{ value: 'all', label: 'All' }, { value: 'equipped', label: 'Equipped' }, { value: 'unequipped', label: 'Unequipped' }]} onChange={(value) => setAssignment(value as typeof assignment)}/></div>
          <label className="check"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}/>Include discarded</label>
          <div className="echo-filter-footer"><button type="button" className="text-button" disabled={activeFilterCount === 0 && !query} onClick={resetFilters}>Clear all</button></div>
        </div>}
      </Panel>
      <div className="echo-picker-list" ref={listRef}>
        {error && <div className="notice error">{error}</div>}
        {pagination}
        <div className="echo-grid">{pageOptions.map((echo) => <EchoMiniCard key={echo.id} echo={echo} selected={echo.id === currentId} rollRating={echoMeta.get(echo.id)?.rollRating} onClick={() => void choose(echo)} equipment={<button type="button" aria-label={`Edit ${echo.name}`} title="Edit Echo" onClick={(event) => { event.stopPropagation(); setEditingEcho(echo) }} onKeyDown={(event) => event.stopPropagation()}><Icon name="edit"/></button>}/>)}</div>
        {pageCount > 1 && pagination}
      </div>
    </section>
  </div>, document.body)}{editingEcho && <EchoEditModal echo={editingEcho} onClose={() => setEditingEcho(null)} onSave={async (updated) => { await db.echoes.put(updated); setEditingEcho(null); await refresh() }}/>}</>
}

function SubstatWeightEditor({ characterName, characterIconSourceUrl, accentClass, initialWeights, recommendedWeights, initialEnergyRegenMinimum, onSave, onReset, onClose }: {
  characterName: string
  characterIconSourceUrl: string
  accentClass: string
  initialWeights: Partial<Record<StatKey, number>>
  recommendedWeights: Partial<Record<StatKey, number>>
  initialEnergyRegenMinimum: number
  onSave: (weights: Partial<Record<StatKey, number>>, energyRegenMinimum: number) => Promise<void>
  onReset: () => Promise<void>
  onClose: () => void
}) {
  const [weights, setWeights] = useState<Partial<Record<StatKey, number>>>(() => ({ ...initialWeights }))
  const [energyRegenMinimum, setEnergyRegenMinimum] = useState(initialEnergyRegenMinimum)
  const [saving, setSaving] = useState(false)
  const dirty = energyRegenMinimum !== initialEnergyRegenMinimum || characterSubstatScoreKeys.some((key) => (weights[key] ?? 0) !== (initialWeights[key] ?? 0))
  useUnsavedChanges(dirty)
  const requestClose = () => { if (confirmDiscardChanges(dirty)) onClose() }
  const setWeight = (key: StatKey, value: number) => setWeights((current) => ({
    ...current,
    [key]: Math.min(4, Math.max(0, Math.round(value * 2) / 2))
  }))
  const submit = async () => {
    setSaving(true)
    try {
      await onSave(Object.fromEntries(characterSubstatScoreKeys.filter((key) => key !== 'energyRegen').flatMap((key) => {
        const weight = Math.round((weights[key] ?? 0) * 2) / 2
        return weight > 0 ? [[key, weight]] : []
      })), energyRegenMinimum)
      onClose()
    } finally {
      setSaving(false)
    }
  }
  const reset = async () => {
    setSaving(true)
    try {
      await onReset()
      onClose()
    } finally {
      setSaving(false)
    }
  }
  return createPortal(<div className={`modal-backdrop cs-weight-editor-backdrop ${accentClass}`} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}><Panel className="cs-weight-editor" role="dialog" aria-modal="true" aria-labelledby="substat-weight-editor-title">
    <header><div className="cs-weight-editor-heading"><img src={characterIconSourceUrl} alt=""/><div><span className="eyebrow">Build preferences · {characterName}</span><h2 id="substat-weight-editor-title">Substat priorities</h2><small>Choose which Echo rolls matter most for this character.</small></div></div><button type="button" className="close" aria-label="Close substat priority editor" onClick={requestClose}>×</button></header>
    <div className="cs-weight-editor-scroll"><p>Set priorities from 0 to 4 in steps of 0.5. Energy Regen is a separate build requirement.</p>
    <label className="cs-er-requirement"><span><strong>Minimum Energy Regen</strong><small>Falling below this value lowers the final build grade by one tier. Use 0 to disable.</small></span><span><BoundedNumberInput aria-label="Minimum Energy Regen" min={0} max={300} step="0.1" value={energyRegenMinimum} onChange={setEnergyRegenMinimum}/><b>%</b></span></label>
    <div className="cs-weight-section-heading"><span className="eyebrow">Echo roll weights</span><small>0 = ignored · 4 = highest priority</small></div>
    <div className="cs-weight-grid">{characterSubstatScoreKeys.filter((key) => key !== 'energyRegen').map((key) => <label key={key}><img src={statIconSource(key)} alt=""/><span>{statLabels[key]}<small>Recommended {recommendedWeights[key] ?? 0}</small></span><div><button type="button" aria-label={`Decrease ${statLabels[key]} priority`} disabled={(weights[key] ?? 0) <= 0} onClick={() => setWeight(key, (weights[key] ?? 0) - 0.5)}>−</button><BoundedNumberInput aria-label={`${statLabels[key]} priority`} min={0} max={4} step="0.5" value={weights[key] ?? 0} onChange={(value) => setWeights((current) => ({ ...current, [key]: value }))}/><button type="button" aria-label={`Increase ${statLabels[key]} priority`} disabled={(weights[key] ?? 0) >= 4} onClick={() => setWeight(key, (weights[key] ?? 0) + 0.5)}>+</button></div></label>)}</div></div>
    <footer><button type="button" className="secondary" disabled={saving} onClick={() => void reset()}>Reset to recommended</button><div><button type="button" className="text-button" disabled={saving} onClick={requestClose}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving...' : 'Save priorities'}</button></div></footer>
  </Panel></div>, document.body)
}

export function CharacterShowcase({ character, characters, catalog, weapons, echoes, builds, equippedLoadouts, theorycraftBuilds, settings, refresh, onBack }: CharacterShowcaseProps) {
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [echoMoveError, setEchoMoveError] = useState('')
  const [loadoutError, setLoadoutError] = useState('')
  const [weaponPickerOpen, setWeaponPickerOpen] = useState(false)
  const [echoSlot, setEchoSlot] = useState<number | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [portraitFailed, setPortraitFailed] = useState(false)
  const [animatedPortraitReady, setAnimatedPortraitReady] = useState(false)
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false)
  const [scoreEditorOpen, setScoreEditorOpen] = useState(false)
  const [layoutControlsHost, setLayoutControlsHost] = useState<HTMLDivElement | null>(null)
  const [layoutPanelHost, setLayoutPanelHost] = useState<HTMLDivElement | null>(null)
  const [cardAccent, setCardAccent] = useState<string | null>(null)
  const [customArtwork, setCustomArtwork] = useState<Blob | undefined>()
  const [customArtworkUrl, setCustomArtworkUrl] = useState<string | undefined>()
  const [loadoutSource, setLoadoutSource] = useState<LoadoutSourceRef>({ type: 'equipped', characterId: character.id })
  const exportRef = useRef<HTMLDivElement>(null)
  const portraitRef = useRef<HTMLImageElement>(null)
  const livePortraitRef = useRef<AnimatedCharacterPortraitHandle>(null)
  const showAnimatedPortrait = useCallback(() => setAnimatedPortraitReady(true), [])
  const showStaticPortrait = useCallback(() => setAnimatedPortraitReady(false), [])

  useEffect(() => {
    setPortraitFailed(false)
    setAnimatedPortraitReady(false)
  }, [catalog.id])

  useEffect(() => {
    if (!settings.liveCharacterArt) setAnimatedPortraitReady(false)
  }, [settings.liveCharacterArt])

  useEffect(() => {
    let active = true
    setCustomArtwork(undefined)
    void loadCharacterArtwork(character.id).then((artwork) => { if (active) setCustomArtwork(artwork) }).catch(() => { if (active) setCustomArtwork(undefined) })
    return () => { active = false }
  }, [character.id])

  useEffect(() => {
    if (!customArtwork) { setCustomArtworkUrl(undefined); return }
    const url = URL.createObjectURL(customArtwork)
    setCustomArtworkUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [customArtwork])

  useEffect(() => {
    if (!exportMessage) return
    const dismiss = () => setExportMessage('')
    const timer = window.setTimeout(dismiss, 5_000)
    document.addEventListener('pointerdown', dismiss, { once: true })
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', dismiss)
    }
  }, [exportMessage])

  const collections = useMemo<LoadoutCollections>(() => ({ characters: [character], weapons, echoes, builds, equippedLoadouts, theorycraftBuilds }), [builds, character, echoes, equippedLoadouts, theorycraftBuilds, weapons])
  const resolvedLoadout = useMemo(() => resolveLoadout(loadoutSource, collections), [collections, loadoutSource])
  const runtimeWeapons = useMemo(() => resolvedLoadout.weapon && !weapons.some((entry) => entry.id === resolvedLoadout.weapon?.id) ? [...weapons, resolvedLoadout.weapon] : weapons, [resolvedLoadout.weapon, weapons])
  const runtimeEchoes = useMemo(() => resolvedLoadout.echoes.some((entry) => !echoes.some((owned) => owned.id === entry.id)) ? [...echoes, ...resolvedLoadout.echoes] : echoes, [echoes, resolvedLoadout.echoes])
  const model = useMemo(() => resolveCharacterShowcaseModel({ character, catalog, weapons: runtimeWeapons, echoes: runtimeEchoes, builds: resolvedLoadout.build ? [resolvedLoadout.build] : [] }), [catalog, character, resolvedLoadout.build, runtimeEchoes, runtimeWeapons])
  const tbaSources = [
    pendingMechanics.character?.[catalog.id]?.length ? catalog.name : '',
    resolvedLoadout.weapon?.catalogId && pendingMechanics.weapon?.[resolvedLoadout.weapon.catalogId]?.length ? 'weapon passive' : '',
    echoCatalog.find((entry) => entry.name === resolvedLoadout.echoes[0]?.name && entry.id && pendingMechanics.echo?.[entry.id]?.length)?.name ?? ''
  ].filter(Boolean)
  const customSubstatWeights = settings.characterSubstatWeights[catalog.id]
  const recommendedSubstatProfile = useMemo(() => resolveCharacterSubstatProfile(catalog), [catalog])
  const characterSubstatProfile = useMemo(() => resolveCharacterSubstatProfile(catalog, customSubstatWeights), [catalog, customSubstatWeights])
  const statRows = useMemo(() => prioritizedBuildCardStats(catalog, characterSubstatProfile), [catalog, characterSubstatProfile])
  if (!model) return null
  const updateCharacter = async (patch: Partial<OwnedCharacter>) => {
    await db.characters.update(character.id, patch)
    await refresh()
  }
  const openEchoPicker = async (slot: number) => {
    if (loadoutSource.type !== 'equipped') return
    setEchoSlot(slot)
  }
  const removeCharacter = async () => {
    if (!deleteArmed) { setDeleteArmed(true); return }
    await db.transaction('rw', [db.characters, db.weapons, db.echoes, db.builds, db.equippedLoadouts, db.theorycraftBuilds, db.teams], async () => {
      await db.characters.delete(character.id)
      await db.weapons.where('equippedBy').equals(character.id).modify({ equippedBy: undefined })
      await db.echoes.where('equippedBy').equals(character.id).modify({ equippedBy: undefined, equippedByName: undefined })
      await db.equippedLoadouts.where('characterId').equals(character.id).delete()
      await db.builds.where('characterId').equals(character.id).delete()
      await db.theorycraftBuilds.where('characterId').equals(character.id).delete()
      await db.teams.toCollection().modify((team) => {
        const removed = new Set((team.members ?? []).filter((member) => member.characterId === character.id).map((member) => member.memberId))
        team.members = (team.members ?? []).filter((member) => !removed.has(member.memberId))
        team.buildIds = team.buildIds.filter((id) => !removed.has(id))
        team.actions = team.actions.filter((action) => !removed.has(action.buildId))
        team.buffs = (team.buffs ?? []).filter((buff) => !removed.has(buff.sourceBuildId))
        const keep = <T,>(record: Record<string, T> = {}) => Object.fromEntries(Object.entries(record).filter(([id]) => !removed.has(id)))
        if (team.scenario) team.scenario = { ...team.scenario, memberConditions: keep(team.scenario.memberConditions), selectedTargetByBuild: keep(team.scenario.selectedTargetByBuild), compareBuildId: team.scenario.compareBuildId && !removed.has(team.scenario.compareBuildId) ? team.scenario.compareBuildId : undefined }
      })
    })
    await repairEchoAssignmentConsistency()
    await deleteCharacterArtwork(character.id).catch(() => undefined)
    await refresh()
    onBack()
  }
  const characterBuilds = builds.filter((entry) => entry.resonatorId === character.catalogId && (!entry.characterId || entry.characterId === character.id))
  const equippedLoadout = equippedLoadouts.find((entry) => entry.characterId === character.id)
  const equippedNumberedBuild = characterBuilds.find((build) => equippedLoadout && /^Build \d+$/.test(build.name)
    && build.weaponId === equippedLoadout.weaponId
    && build.echoIds.length === equippedLoadout.echoIds.length
    && build.echoIds.every((id, index) => id === equippedLoadout.echoIds[index]))
  const loadoutSources: Array<{ source: LoadoutSourceRef; label: string }> = [
    { source: { type: 'equipped', characterId: character.id }, label: equippedNumberedBuild ? `Equipped · ${equippedNumberedBuild.name}` : 'Equipped Build' },
    ...characterBuilds.filter((entry) => entry.id !== equippedNumberedBuild?.id).map((entry) => ({ source: { type: 'saved' as const, buildId: entry.id }, label: `Saved · ${entry.name}` })),
    ...theorycraftBuilds.filter((entry) => entry.characterId === character.id).map((entry) => ({ source: { type: 'theorycraft' as const, theorycraftBuildId: entry.id }, label: `Theorycraft · ${entry.name}` }))
  ]
  const changeLoadout = async (value: string) => {
    const separator = value.indexOf(':')
    const type = value.slice(0, separator)
    const id = value.slice(separator + 1)
    setLoadoutError('')
    if (type === 'saved') {
      try {
        await equipSavedBuild(id)
        await refresh()
        setLoadoutSource({ type: 'equipped', characterId: character.id })
      } catch (error) {
        setLoadoutError(error instanceof Error ? error.message : 'The build could not be equipped.')
      }
      return
    }
    setLoadoutSource(type === 'equipped' ? { type, characterId: id } : { type: 'theorycraft', theorycraftBuildId: id })
  }
  const innateTuneBreakBoost = baseTuneBreakBoost(catalog)
  const statDetail = (key: BuildCardStatKey, label: string): CalculationDetail => key === 'tuneBreakBoost'
    ? { title: label, value: innateTuneBreakBoost.toFixed(1), formula: 'Character Tune Break baseline', rows: [{ label: 'Base Tune Break Boost', value: innateTuneBreakBoost.toFixed(1) }] }
    : key === 'incomingHealingBonus'
      ? { title: label, value: `${model.incomingHealingBonus.toFixed(1)}%`, formula: '6.2% per 1,000 Max HP, up to 310%', rows: [{ label: 'Nether to Light', value: `${model.incomingHealingBonus.toFixed(1)}%` }] }
    : showcaseStatDetail(model, key, label)
  const exportCharacterCard = async () => {
    const frame = exportRef.current
    if (!frame || exporting) return
    setExporting(true)
    setExportMessage('')
    let originalPortraitSource: string | undefined
    let exportHost: HTMLDivElement | undefined
    try {
      await nextPaint()
      const livePortraitSnapshot = settings.liveCharacterArt && animatedPortraitReady ? livePortraitRef.current?.captureFrame() : undefined
      if (portraitRef.current) {
        try {
          originalPortraitSource = await inlineImageSource(portraitRef.current)
        } catch {
          await portraitRef.current.decode().catch(() => undefined)
        }
      }

      const exportFrame = frame.cloneNode(true) as HTMLDivElement
      const frameStyles = getComputedStyle(frame)
      for (const property of ['--cbc-accent']) {
        exportFrame.style.setProperty(property, frameStyles.getPropertyValue(property))
      }
      exportFrame.classList.add('is-exporting')
      exportFrame.style.transform = 'none'
      const snapshotImage = exportFrame.querySelector<HTMLImageElement>('.cbc-live-portrait-snapshot')
      if (livePortraitSnapshot && snapshotImage) {
        snapshotImage.src = livePortraitSnapshot
        exportFrame.classList.add('has-live-portrait-snapshot')
      } else {
        snapshotImage?.remove()
      }
      exportHost = document.createElement('div')
      exportHost.style.position = 'fixed'
      exportHost.style.left = '-100000px'
      exportHost.style.top = '0'
      exportHost.style.width = '1920px'
      exportHost.style.pointerEvents = 'none'
      exportHost.style.zIndex = '-1'
      exportHost.append(exportFrame)
      document.body.append(exportHost)
      await Promise.all(Array.from(exportFrame.querySelectorAll('img')).map(async (image) => {
        if (!image.complete) await new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        })
        await image.decode().catch(() => undefined)
      }))
      await nextPaint()
      try {
        await bakeExportGlassBackdrops(exportFrame)
      } catch (error) {
        console.warn('Character card backdrop blur could not be baked; using the export-safe glass fallback.', error)
      }
      await nextPaint()
      const rendered = await renderExportFrame(exportFrame)
      const card: CardMetadata | undefined = model.weapon && model.equippedEchoes.length ? {
        format: 'tacet-lab-card', version: 1,
        characterCatalogId: catalog.id, characterLevel: character.level, sequence: character.sequence,
        skillLevels: model.skillLevels, weaponCatalogId: model.weapon.catalog.id,
        weaponLevel: model.weapon.owned.level, weaponRank: model.weapon.owned.rank,
        echoes: model.equippedEchoes.map(({ name, cost, rarity, level, sonata, mainStat, subStats }) => ({ name, cost, rarity, level, sonata, mainStat, subStats }))
      } : undefined
      const dataUrl = card ? await embedCardMetadata(rendered, card) : rendered
      const anchor = document.createElement('a')
      anchor.download = `${catalog.name.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-character-card.png`
      anchor.href = dataUrl
      anchor.click()
      setExportMessage(card ? 'Character card exported as a 1920 × 1080 PNG with reimport data.' : 'Character card exported as a 1920 × 1080 PNG. Add a weapon and Echo to enable reimport.')
    } catch {
      setExportMessage('Image export failed. Reload the page and try again.')
    } finally {
      exportHost?.remove()
      if (originalPortraitSource && portraitRef.current) portraitRef.current.src = originalPortraitSource
      setExporting(false)
    }
  }
  const enabledSkillTreeNodeIds = character.enabledSkillTreeBonusIds ?? defaultEnabledSkillTreeBonusIds(catalog)
  const toggleSkillTreeNode = async (id: string) => {
    const enabled = new Set(enabledSkillTreeNodeIds)
    const nodeChains: string[][] = []
    for (const [branch, bonuses] of Object.entries(catalog.skillTreeExtras.bonusStatBranches)) {
      nodeChains.push(bonuses.map((_, index) => skillTreeBonusId(branch as keyof typeof catalog.skillTreeExtras.bonusStatBranches, index)))
    }
    nodeChains.push(catalog.skillTreeExtras.inherentSkills.map((_, index) => inherentSkillBonusId(index)))
    const chain = nodeChains.find((nodeIds) => nodeIds.includes(id))
    const nodeIndex = chain?.indexOf(id) ?? -1
    if (enabled.has(id)) {
      if (chain && nodeIndex >= 0) chain.slice(nodeIndex).forEach((nodeId) => enabled.delete(nodeId))
      else enabled.delete(id)
    } else if (chain && nodeIndex >= 0) chain.slice(0, nodeIndex + 1).forEach((nodeId) => enabled.add(nodeId))
    else enabled.add(id)
    await updateCharacter({ enabledSkillTreeBonusIds: [...enabled].sort() })
  }
  const saveSubstatWeights = async (weights: Partial<Record<StatKey, number>>, energyRegenMinimum: number) => {
    await saveSettings({
      ...settings,
      characterSubstatWeights: { ...settings.characterSubstatWeights, [catalog.id]: weights },
      characterEnergyRegenMinimums: { ...settings.characterEnergyRegenMinimums, [catalog.id]: energyRegenMinimum }
    })
    await refresh()
  }
  const resetSubstatWeights = async () => {
    const characterSubstatWeights = { ...settings.characterSubstatWeights }
    const characterEnergyRegenMinimums = { ...settings.characterEnergyRegenMinimums }
    delete characterSubstatWeights[catalog.id]
    delete characterEnergyRegenMinimums[catalog.id]
    await saveSettings({ ...settings, characterSubstatWeights, characterEnergyRegenMinimums })
    await refresh()
  }

  return <CharacterSubstatProfileContext.Provider value={characterSubstatProfile}><section className={`cs-page cs-element-${catalog.element.toLowerCase()}`} style={customAccentStyle(cardAccent)}>
    <header className="cs-toolbar"><button className="cs-back" onClick={onBack}>← Characters</button><div className="cs-toolbar-identity"><strong>{catalog.name}</strong><small>{loadoutSource.type === 'equipped' ? 'Tap a card section to edit' : 'Build preview'}</small></div><label className="cs-loadout-source"><select aria-label="Build" value={loadoutSource.type === 'equipped' ? `equipped:${loadoutSource.characterId}` : loadoutSource.type === 'saved' ? `saved:${loadoutSource.buildId}` : `theorycraft:${loadoutSource.theorycraftBuildId}`} onChange={(event) => void changeLoadout(event.target.value)}>{loadoutSources.map(({ source, label }) => { const value = source.type === 'equipped' ? `equipped:${source.characterId}` : source.type === 'saved' ? `saved:${source.buildId}` : `theorycraft:${source.theorycraftBuildId}`; return <option value={value} key={value}>{label}</option> })}</select></label><div className="cs-layout-controls-host" ref={setLayoutControlsHost}/><div className="cs-toolbar-actions"><button aria-label={character.favorite ? 'Remove from favorites' : 'Add to favorites'} className={character.favorite ? 'cs-favorite active' : 'cs-favorite'} onClick={() => void updateCharacter({ favorite: !character.favorite })}>{character.favorite ? '♥ Favorited' : '♡ Favorite'}</button><button aria-label={deleteArmed ? 'Confirm character deletion' : 'Delete character'} className={`danger ${deleteArmed ? 'is-armed' : ''}`} onClick={() => void removeCharacter()}><Icon name="trash"/><span>{deleteArmed ? 'Confirm delete' : 'Delete'}</span></button><button aria-label="Export character card" title="Complete build PNGs include full build data, including hidden card sections, for reimport." className="secondary cs-export-button" disabled={exporting} onClick={() => void exportCharacterCard()}><Icon name="download"/><span>{exporting ? 'Rendering...' : 'Export'}</span></button></div></header>
    {exportMessage && <div className={`cs-export-message ${exportMessage.startsWith('Image export failed') ? 'is-error' : ''}`} role="status">{exportMessage}</div>}
    {loadoutError && <div className="notice error" role="alert">{loadoutError}</div>}
    {echoMoveError && <div className="notice error" role="alert">{echoMoveError}</div>}
    {tbaSources.length > 0 && <div className="notice">TBA mechanics for {tbaSources.join(', ')} are omitted from calculated stats and damage.</div>}

    <div className="cs-card-workspace"><CharacterBuildCard
      ref={exportRef}
      character={character}
      catalog={catalog}
      model={model}
      settings={settings}
      profile={characterSubstatProfile}
      statRows={statRows}
      statDetail={statDetail}
      editable={loadoutSource.type === 'equipped'}
      portraitRef={portraitRef}
      livePortraitRef={livePortraitRef}
      portraitFailed={portraitFailed}
      animatedPortraitReady={animatedPortraitReady}
      pauseLivePortrait={exporting || weaponPickerOpen || echoSlot !== null || scoreEditorOpen || scoreInfoOpen}
      enabledSkillTreeNodeIds={enabledSkillTreeNodeIds}
      onPortraitError={() => { if (!portraitFailed && catalog.portraitSourceUrl && catalog.portraitSourceUrl !== catalog.iconSourceUrl) setPortraitFailed(true) }}
      onLiveReady={showAnimatedPortrait}
      onLiveFallback={showStaticPortrait}
      onSetLevel={(level) => void updateCharacter({ level })}
      onSetSequence={(sequence) => void updateCharacter({ sequence })}
      onSetSkillLevel={(index, level) => { const levels = [...model.skillLevels]; levels[index] = level; void updateCharacter({ skillLevels: levels }) }}
      onToggleSkillTreeNode={(id) => void toggleSkillTreeNode(id)}
      onOpenWeapon={() => setWeaponPickerOpen(true)}
      onOpenEcho={(index) => void openEchoPicker(index)}
      onMoveEcho={(from, to) => { const ids = resolvedLoadout.build?.echoIds ?? []; if (loadoutSource.type !== 'equipped' || !ids[from]) return; setEchoMoveError(''); void setEquippedEchoIds(character.id, assignEchoSlot(ids, to, ids[from])).then(refresh).catch(() => setEchoMoveError('The Echo could not be moved. Please try again.')) }}
      onEditPriorities={() => setScoreEditorOpen(true)}
      onShowScoreInfo={() => setScoreInfoOpen(true)}
      customArtworkUrl={customArtworkUrl}
      onUploadArtwork={async (file) => { await saveCharacterArtwork(character.id, file); setCustomArtwork(file); setPortraitFailed(false); setAnimatedPortraitReady(false) }}
      onRestoreArtwork={async () => { await deleteCharacterArtwork(character.id); setCustomArtwork(undefined); setPortraitFailed(false); setAnimatedPortraitReady(false) }}
      onAccentChange={setCardAccent}
      layoutControlsHost={layoutControlsHost}
      layoutPanelHost={layoutPanelHost}
    />
    <div className="cs-layout-panel-host" ref={setLayoutPanelHost}/></div>

    {weaponPickerOpen && <WeaponPicker key={character.id} character={character} characters={characters} catalog={catalog} weapons={weapons} builds={builds} equippedLoadouts={equippedLoadouts} refresh={refresh} onClose={() => setWeaponPickerOpen(false)}/>}
    {echoSlot !== null && loadoutSource.type === 'equipped' && <EchoPicker
      key={character.id}
      slot={echoSlot}
      characterId={character.id}
      currentIds={resolvedLoadout.build?.echoIds ?? []}
      echoes={echoes}
      accentClass={`cs-element-${catalog.element.toLowerCase()}`}
      refresh={refresh}
      onClose={() => setEchoSlot(null)}
    />}
    {scoreEditorOpen && <SubstatWeightEditor characterName={catalog.name} characterIconSourceUrl={catalog.iconSourceUrl} accentClass={`cs-element-${catalog.element.toLowerCase()}`} initialWeights={characterSubstatProfile.weights} recommendedWeights={recommendedSubstatProfile.weights} initialEnergyRegenMinimum={settings.characterEnergyRegenMinimums[catalog.id] ?? 0} onSave={saveSubstatWeights} onReset={resetSubstatWeights} onClose={() => setScoreEditorOpen(false)}/>}
    {scoreInfoOpen && createPortal(<div className={`modal-backdrop roll-quality-backdrop cs-element-${catalog.element.toLowerCase()}`} onMouseDown={() => setScoreInfoOpen(false)}><Panel className="roll-quality-modal cs-score-info-modal" role="dialog" aria-modal="true" aria-labelledby="substat-score-info-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">Character-specific Echo evaluation</span><h2 id="substat-score-info-title">How Substat Score works</h2></div><button className="close" aria-label="Close Substat Score information" onClick={() => setScoreInfoOpen(false)}>×</button></header>
      <div className="roll-quality-scroll">
      <p>Substat Score measures how useful an Echo's revealed rolls are for {catalog.name}. Unlike Roll Grade, it values the stats this character actually wants.</p>
      <section><h3>1. Find the roll tier</h3><p>Percentage substats earn 1–8 tier points from their position among the eight fixed in-game roll values. Flat HP, ATK, and DEF use 3 tier points.</p><div className="roll-tier-legend"><span className="tier-low">1 · White</span><span className="tier-mid">2 · Green</span><span className="tier-high">3–4 · Blue</span><span className="tier-strong">5–6 · Purple</span><span className="tier-perfect">7–8 · Gold</span></div></section>
      <section><h3>2. Apply this character's priority</h3><p>Every configured stat has a character-specific weight. Energy Regen is excluded and instead uses the configured minimum requirement.</p><div className="score-weight-legend"><span className="weight-4">4 Highest</span><span className="weight-3">3 Strong</span><span className="weight-2">2 Useful</span><span className="weight-1">1 Marginal</span></div><div className="quality-formula"><b>Roll tier</b><span>×</span><b>Character weight</b><span>= contribution</span></div></section>
      <section><h3>3. Normalize the total</h3><p>Each ER substat is removed from both the earned points and the 25-roll denominator. If total ER is below the configured minimum, the earned build grade drops by one tier. Fewer than five revealed substats produce a provisional score marked with an asterisk.</p><div className="quality-formula"><b>Earned non-ER points</b><span>÷</span><b>25 minus ER rolls</b><span>= score %</span></div><div className="score-grade-legend"><span className="grade-e">E<small>0–14.9%</small></span><span className="grade-d">D<small>15–24.9%</small></span><span className="grade-c">C<small>25–34.9%</small></span><span className="grade-b">B<small>35–44.9%</small></span><span className="grade-a">A<small>45–54.9%</small></span><span className="grade-s">S<small>55–64.9%</small></span><span className="grade-ss">SS<small>65–74.9%</small></span><span className="grade-sss">SSS<small>75–100%</small></span></div></section>
      </div>
    </Panel></div>, document.body)}
  </section></CharacterSubstatProfileContext.Provider>
}

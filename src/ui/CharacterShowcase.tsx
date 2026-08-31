import { useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { toPng } from 'html-to-image'
import { baseTuneBreakBoost, characterCatalog, sonataNames, statLabels, weaponCatalog, type CharacterCatalogEntry, type WeaponCatalogEntry } from '../game-data'
import { characterSubstatScoreKeys } from '../game-data/character-substat-preferences'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { effectiveSubStats } from '../game-data/echo-main-stats'
import { echoRollRating } from '../domain/echo-grade'
import { resolveCharacterSubstatProfile, scoreCharacterSubstats } from '../domain/character-substat-score'
import { createLocalId } from '../domain/id'
import { resolveLoadout, type LoadoutCollections } from '../domain/loadouts'
import { db, saveSettings, setOwnedWeaponOwner } from '../storage/database'
import { deleteCharacterArtwork, loadCharacterArtwork, saveCharacterArtwork } from '../storage/character-art-cache'
import { setEquippedEchoIds } from '../storage/loadouts'
import type { AppSettings, Build, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, StatKey, TheorycraftBuild } from '../domain/types'
import { CharacterSubstatProfileContext, EchoMiniCard, EquippedCharacterLabel, Icon, Panel } from './components'
import { EchoEditModal } from './EchoEditModal'
import type { NanokaSpinePortraitHandle } from './NanokaSpinePortrait'
import type { CalculationDetail } from './CalculationDetails'
import { showcaseStatDetail } from './calculation-detail-model'
import { CharacterBuildCard, prioritizedBuildCardStats, type BuildCardStatKey } from './CharacterBuildCard'
import { defaultEnabledSkillTreeBonusIds, inherentSkillBonusId, resolveCharacterShowcaseModel, skillTreeBonusId } from './character-showcase-model'
import { WeaponInventoryCard } from './WeaponInventoryCard'
import { useDismissableLayer } from './useDismissableLayer'
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

function renderExportFrame(frame: HTMLElement) {
  return toPng(frame, {
    width: EXPORT_CARD_WIDTH,
    height: EXPORT_CARD_HEIGHT,
    pixelRatio: 1,
    cacheBust: true,
    backgroundColor: '#030708',
    style: { width: `${EXPORT_CARD_WIDTH}px`, height: `${EXPORT_CARD_HEIGHT}px`, maxWidth: 'none', transform: 'none' }
  })
}

async function loadExportImage(source: string) {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}

async function bakeExportGlassBackdrops(exportFrame: HTMLDivElement) {
  const host = exportFrame.parentElement
  if (!host) return

  const backgroundFrame = exportFrame.cloneNode(true) as HTMLDivElement
  backgroundFrame.classList.add('is-exporting-background')
  backgroundFrame.classList.remove('has-live-portrait-snapshot')
  backgroundFrame.querySelector('.cbc-live-portrait-snapshot')?.remove()
  host.append(backgroundFrame)
  await nextPaint()

  let backgroundSource: string
  try {
    backgroundSource = await renderExportFrame(backgroundFrame)
  } finally {
    backgroundFrame.remove()
  }

  const backgroundImage = await loadExportImage(backgroundSource)
  const padding = EXPORT_BACKDROP_BLUR * 3
  const blurred = document.createElement('canvas')
  blurred.width = EXPORT_CARD_WIDTH + padding * 2
  blurred.height = EXPORT_CARD_HEIGHT + padding * 2
  const blurContext = blurred.getContext('2d')
  if (!blurContext) return
  blurContext.filter = `blur(${EXPORT_BACKDROP_BLUR}px)`
  blurContext.drawImage(backgroundImage, padding, padding, EXPORT_CARD_WIDTH, EXPORT_CARD_HEIGHT)

  const frameBounds = exportFrame.getBoundingClientRect()
  if (!frameBounds.width || !frameBounds.height) return
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
    panel.style.setProperty('--cbc-export-backdrop-image', `url("${crop.toDataURL('image/png')}")`)
    panel.classList.add('has-export-backdrop')
  }
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

function EchoFilterSelect({ label, values, options, emptyLabel, onChange, icon }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; emptyLabel: string; onChange: (values: string[]) => void; icon?: (value: string) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismissableLayer(open, ref, close)
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  return <label className="multi-filter">{label}<div className="multi-select" ref={ref}><button type="button" className="multi-select-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="multi-select-values">{values.length ? values.map((value) => <span className="multi-select-chip" key={value}>{icon?.(value)}<b>{options.find((option) => option.value === value)?.label ?? value}</b></span>) : <em>{emptyLabel}</em>}</span><strong>⌄</strong></button>{open && <div className="multi-select-menu"><div className="multi-select-options">{options.map((option) => <button type="button" className={values.includes(option.value) ? 'active' : ''} onClick={() => toggle(option.value)} key={option.value}>{icon?.(option.value)}<span>{option.label}</span><i>{values.includes(option.value) ? '✓' : ''}</i></button>)}</div><footer><button type="button" className="multi-select-clear" disabled={!values.length} onClick={() => onChange([])}>Clear selections</button></footer></div>}</div></label>
}

function WeaponPicker({ character, characters, catalog, weapons, refresh, onClose }: { character: OwnedCharacter; characters: OwnedCharacter[]; catalog: CharacterCatalogEntry; weapons: OwnedWeapon[]; refresh: () => Promise<void>; onClose: () => void }) {
  const [adding, setAdding] = useState(false)
  const eligibleOwned = weapons.flatMap((owned) => {
    const entry = weaponCatalog.find((candidate) => candidate.id === owned.catalogId)
    return entry?.type.toLowerCase() === catalog.weaponType.toLowerCase() ? [{ owned, entry }] : []
  })
  const eligibleCatalog = weaponCatalog.filter((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())
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
  return createPortal(<div className={`catalog-picker-backdrop cs-picker-backdrop cs-element-${catalog.element.toLowerCase()}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="catalog-picker cs-picker" role="dialog" aria-modal="true" aria-label="Equip weapon"><header><div><span className="eyebrow">{catalog.weaponType} inventory</span><h2>{adding ? 'Add and equip weapon' : 'Equip weapon'}</h2></div><div>{adding && <button className="secondary" onClick={() => setAdding(false)}>Owned</button>}<button className="text-button" onClick={onClose}>Close</button></div></header><div className="catalog-picker-grid">
    {!adding && eligibleOwned.map(({ owned, entry }) => { const owner = characters.find((candidate) => candidate.id === owned.equippedBy); const ownerCatalog = characterCatalog.find((candidate) => candidate.id === owner?.catalogId); return <WeaponInventoryCard weapon={owned} catalog={entry} className="cs-weapon-picker-card" ariaLabel={`Equip ${entry.name}`} onClick={() => void equip(owned)} footer={<button type="button" className="character-equip-trigger cs-weapon-picker-owner" onClick={() => void equip(owned)}>{ownerCatalog ? <img src={ownerCatalog.iconSourceUrl} alt=""/> : <span className="equip-empty">—</span>}<b>{ownerCatalog?.name ?? 'Unequipped'}</b><i>Equip</i></button>} key={owned.id}/> })}
    {!adding && <button className="catalog-choice add-owned-choice" onClick={() => setAdding(true)}><span className="add-glyph">+</span><span><strong>Add weapon</strong><small>Create a local copy and equip it.</small></span></button>}
    {adding && eligibleCatalog.map((entry) => <button className={`catalog-choice weapon-choice rarity-${entry.rarity}`} key={entry.id} onClick={() => void add(entry)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>{entry.type}</small><Stars rarity={entry.rarity}/></span></button>)}
  </div></section></div>, document.body)
}

function EchoPicker({ slot, characterId, currentIds, echoes, accentClass, refresh, onClose }: { slot: number; characterId: string; currentIds: string[]; echoes: Echo[]; accentClass: string; refresh: () => Promise<void>; onClose: () => void }) {
  const characterSubstatProfile = useContext(CharacterSubstatProfileContext)
  const currentId = currentIds[slot]
  const [query, setQuery] = useState('')
  const [costs, setCosts] = useState<number[]>([])
  const [rarities, setRarities] = useState<number[]>([])
  const [sonatas, setSonatas] = useState<string[]>([])
  const [mainStats, setMainStats] = useState<string[]>([])
  const [subStats, setSubStats] = useState<string[]>([])
  const [lockState, setLockState] = useState<'all' | 'locked' | 'unlocked'>('all')
  const [assignment, setAssignment] = useState<'all' | 'equipped' | 'unequipped'>('all')
  const [showExcluded, setShowExcluded] = useState(false)
  const [error, setError] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const statKeys = Object.keys(statLabels) as StatKey[]
  const toggleNumber = (values: number[], value: number, change: (next: number[]) => void) => change(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  const resetFilters = () => { setQuery(''); setCosts([]); setRarities([]); setSonatas([]); setMainStats([]); setSubStats([]); setLockState('all'); setAssignment('all'); setShowExcluded(false) }
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
    (!costs.length || costs.includes(echo.cost)) &&
    (!rarities.length || rarities.includes(echo.rarity)) &&
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
  const choose = async (next?: Echo) => {
    setError('')
    try {
      const nextIds = [...currentIds]
      if (next) nextIds[slot] = next.id
      else nextIds.splice(slot, 1)
      await setEquippedEchoIds(characterId, nextIds.filter(Boolean))
      await refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Echo could not be switched.')
    }
  }
  return createPortal(<div className={`catalog-picker-backdrop cs-picker-backdrop ${accentClass}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="catalog-picker cs-picker cs-echo-picker" role="dialog" aria-modal="true" aria-label={`Equip Echo slot ${slot + 1}`}>
      <header><div><span className="eyebrow">Echo slot {slot + 1}</span><h2>Equip Echo</h2></div><button className="text-button" onClick={onClose}>Close</button></header>
      <div className="cs-echo-picker-filters">
        <div className="filter-heading"><div><strong>Echo filters</strong><span>{options.length} / {echoes.length} shown</span></div><button className="text-button" onClick={resetFilters}>Reset</button></div>
        <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Echo, Sonata, or stat..."/></label>
        <div className="filter-body">
          <div className="filter-group"><span>Cost</span><div className="filter-chips">{[1,3,4].map((value) => <button className={costs.includes(value) ? 'active' : ''} onClick={() => toggleNumber(costs, value, setCosts)} key={value}>{value} cost</button>)}</div></div>
          <div className="filter-group"><span>Rarity</span><div className="filter-chips">{[5,4,3,2,1].map((value) => <button className={rarities.includes(value) ? 'active' : ''} onClick={() => toggleNumber(rarities, value, setRarities)} key={value}>{value} ★</button>)}</div></div>
          <EchoFilterSelect label="Sonata" values={sonatas} options={sonataNames.map((name) => ({ value: name, label: name }))} emptyLabel="All Sonatas" onChange={setSonatas} icon={(name) => <img src={generatedSonataIconSources[name]} alt=""/>}/>
          <EchoFilterSelect label="Main stat" values={mainStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any main stat" onChange={setMainStats}/>
          <EchoFilterSelect label="Substat" values={subStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any substat" onChange={setSubStats}/>
          <label>Lock state<select value={lockState} onChange={(event) => setLockState(event.target.value as typeof lockState)}><option value="all">All</option><option value="locked">Locked</option><option value="unlocked">Unlocked</option></select></label>
          <label>Equipped<select value={assignment} onChange={(event) => setAssignment(event.target.value as typeof assignment)}><option value="all">All</option><option value="equipped">Equipped anywhere</option><option value="unequipped">Unequipped</option></select></label>
          <label className="check"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}/>Include discarded</label>
        </div>
      </div>
      <div className="echo-picker-list">
        {error && <div className="notice error">{error}</div>}
        {currentId && <button className="danger" onClick={() => void choose()}>Unequip current Echo</button>}
        <div className="echo-picker-options">{options.map((echo) => <EchoMiniCard key={echo.id} echo={echo} selected={echo.id === currentId} rollRating={echoMeta.get(echo.id)?.rollRating} onClick={() => void choose(echo)} equipment={echo.equippedBy && echo.equippedBy !== characterId ? <EquippedCharacterLabel name={echo.equippedByName ?? 'Another character'}/> : undefined}/>)}</div>
      </div>
    </section>
  </div>, document.body)
}

function SubstatWeightEditor({ characterName, accentClass, initialWeights, recommendedWeights, initialEnergyRegenMinimum, onSave, onReset, onClose }: {
  characterName: string
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
      })), Math.max(0, Math.min(300, energyRegenMinimum)))
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
  return createPortal(<div className={`modal-backdrop cs-weight-editor-backdrop ${accentClass}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><Panel className="cs-weight-editor" role="dialog" aria-modal="true" aria-labelledby="substat-weight-editor-title">
    <header><div><span className="eyebrow">Character substat priorities</span><h2 id="substat-weight-editor-title">Configure {characterName}</h2></div><button type="button" className="close" aria-label="Close substat priority editor" onClick={onClose}>×</button></header>
    <div className="cs-weight-editor-scroll"><p>Set a priority from 0 to 4 in 0.5 intervals. Energy Regen is handled separately as a build requirement and does not add Substat Score.</p>
    <label className="cs-er-requirement"><span><strong>Minimum Energy Regen</strong><small>Falling below this value lowers the final build grade by one tier. Use 0 to disable.</small></span><span><input aria-label="Minimum Energy Regen" type="number" min="0" max="300" step="0.1" value={energyRegenMinimum} onChange={(event) => setEnergyRegenMinimum(Number(event.target.value) ||0)}/><b>%</b></span></label>
    <div className="cs-weight-grid">{characterSubstatScoreKeys.filter((key) => key !== 'energyRegen').map((key) => <label key={key}><span>{statLabels[key]}<small>Recommended: {recommendedWeights[key] ?? 0}</small></span><div><button type="button" aria-label={`Decrease ${statLabels[key]} priority`} disabled={(weights[key] ?? 0) <= 0} onClick={() => setWeight(key, (weights[key] ?? 0) - 0.5)}>−</button><input aria-label={`${statLabels[key]} priority`} type="number" min="0" max="4" step="0.5" value={weights[key] ?? 0} onChange={(event) => setWeight(key, Number(event.target.value) || 0)}/><button type="button" aria-label={`Increase ${statLabels[key]} priority`} disabled={(weights[key] ?? 0) >= 4} onClick={() => setWeight(key, (weights[key] ?? 0) + 0.5)}>+</button></div></label>)}</div></div>
    <footer><button type="button" className="secondary" disabled={saving} onClick={() => void reset()}>Reset to recommended</button><div><button type="button" className="text-button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving...' : 'Save priorities'}</button></div></footer>
  </Panel></div>, document.body)
}

export function CharacterShowcase({ character, characters, catalog, weapons, echoes, builds, equippedLoadouts, theorycraftBuilds, settings, refresh, onBack }: CharacterShowcaseProps) {
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [weaponPickerOpen, setWeaponPickerOpen] = useState(false)
  const [echoSlot, setEchoSlot] = useState<number | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [portraitFailed, setPortraitFailed] = useState(false)
  const [animatedPortraitReady, setAnimatedPortraitReady] = useState(false)
  const [editingEcho, setEditingEcho] = useState<Echo | null>(null)
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
  const livePortraitRef = useRef<NanokaSpinePortraitHandle>(null)
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
        if (team.calculationV2) team.calculationV2 = { ...team.calculationV2, memberEffects: keep(team.calculationV2.memberEffects), partyEffects: Object.fromEntries(Object.entries(keep(team.calculationV2.partyEffects)).map(([sourceId, effects]) => [sourceId, Object.fromEntries(Object.entries(effects).map(([effectId, selection]) => [effectId, { ...selection, recipientBuildId: selection.recipientBuildId && !removed.has(selection.recipientBuildId) ? selection.recipientBuildId : undefined }]))])), selectedAttackByBuild: keep(team.calculationV2.selectedAttackByBuild) }
      })
    })
    await deleteCharacterArtwork(character.id).catch(() => undefined)
    await refresh()
    onBack()
  }
  const loadoutSources: Array<{ source: LoadoutSourceRef; label: string }> = [
    { source: { type: 'equipped', characterId: character.id }, label: 'Equipped Build' },
    ...builds.filter((entry) => entry.resonatorId === character.catalogId && (!entry.characterId || entry.characterId === character.id)).map((entry) => ({ source: { type: 'saved' as const, buildId: entry.id }, label: `Saved · ${entry.name}` })),
    ...theorycraftBuilds.filter((entry) => entry.characterId === character.id).map((entry) => ({ source: { type: 'theorycraft' as const, theorycraftBuildId: entry.id }, label: `Theorycraft · ${entry.name}` }))
  ]
  const innateTuneBreakBoost = baseTuneBreakBoost(catalog)
  const statDetail = (key: BuildCardStatKey, label: string): CalculationDetail => key === 'tuneBreakBoost'
    ? { title: label, value: innateTuneBreakBoost.toFixed(1), formula: 'Character Tune Break baseline', rows: [{ label: 'Base Tune Break Boost', value: innateTuneBreakBoost.toFixed(1) }] }
    : showcaseStatDetail(model, key, label)
  const exportCharacterCard = async () => {
    const frame = exportRef.current
    if (!frame || exporting) return
    setExporting(true)
    setExportMessage('')
    let originalPortraitSource: string | undefined
    let exportHost: HTMLDivElement | undefined
    try {
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
      const dataUrl = await renderExportFrame(exportFrame)
      const anchor = document.createElement('a')
      anchor.download = `${catalog.name.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-character-card.png`
      anchor.href = dataUrl
      anchor.click()
      setExportMessage('Character card exported as a 1920 × 1080 PNG.')
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
    <header className="cs-toolbar"><button className="cs-back" onClick={onBack}>← Characters</button><div className="cs-toolbar-identity"><strong>{catalog.name}</strong><small>{loadoutSource.type === 'equipped' ? 'Tap a card section to edit' : 'Build preview'}</small></div><label className="cs-loadout-source"><select aria-label="Build" value={loadoutSource.type === 'equipped' ? `equipped:${loadoutSource.characterId}` : loadoutSource.type === 'saved' ? `saved:${loadoutSource.buildId}` : `theorycraft:${loadoutSource.theorycraftBuildId}`} onChange={(event) => { const separator = event.target.value.indexOf(':'); const type = event.target.value.slice(0, separator); const id = event.target.value.slice(separator + 1); setLoadoutSource(type === 'equipped' ? { type, characterId: id } : type === 'saved' ? { type, buildId: id } : { type: 'theorycraft', theorycraftBuildId: id }) }}>{loadoutSources.map(({ source, label }) => { const value = source.type === 'equipped' ? `equipped:${source.characterId}` : source.type === 'saved' ? `saved:${source.buildId}` : `theorycraft:${source.theorycraftBuildId}`; return <option value={value} key={value}>{label}</option> })}</select></label><div className="cs-layout-controls-host" ref={setLayoutControlsHost}/><div className="cs-toolbar-actions"><button aria-label={character.favorite ? 'Remove from favorites' : 'Add to favorites'} className={character.favorite ? 'cs-favorite active' : 'cs-favorite'} onClick={() => void updateCharacter({ favorite: !character.favorite })}>{character.favorite ? '♥ Favorited' : '♡ Favorite'}</button><button aria-label={deleteArmed ? 'Confirm character deletion' : 'Delete character'} className={`danger ${deleteArmed ? 'is-armed' : ''}`} onClick={() => void removeCharacter()}><Icon name="trash"/><span>{deleteArmed ? 'Confirm delete' : 'Delete'}</span></button><button aria-label="Export character card" className="secondary cs-export-button" disabled={exporting} onClick={() => void exportCharacterCard()}><Icon name="download"/><span>{exporting ? 'Rendering...' : 'Export'}</span></button></div></header>
    {exportMessage && <div className={`cs-export-message ${exportMessage.startsWith('Image export failed') ? 'is-error' : ''}`} role="status">{exportMessage}</div>}

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
      onEditEcho={setEditingEcho}
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

    {weaponPickerOpen && <WeaponPicker character={character} characters={characters} catalog={catalog} weapons={weapons} refresh={refresh} onClose={() => setWeaponPickerOpen(false)}/>}
    {echoSlot !== null && loadoutSource.type === 'equipped' && <EchoPicker
      slot={echoSlot}
      characterId={character.id}
      currentIds={resolvedLoadout.build?.echoIds ?? []}
      echoes={echoes}
      accentClass={`cs-element-${catalog.element.toLowerCase()}`}
      refresh={refresh}
      onClose={() => setEchoSlot(null)}
    />}
    {editingEcho && <EchoEditModal echo={editingEcho} onClose={() => setEditingEcho(null)} onSave={async (updated) => { await db.echoes.put(updated); setEditingEcho(null); await refresh() }}/>}
    {scoreEditorOpen && <SubstatWeightEditor characterName={catalog.name} accentClass={`cs-element-${catalog.element.toLowerCase()}`} initialWeights={characterSubstatProfile.weights} recommendedWeights={recommendedSubstatProfile.weights} initialEnergyRegenMinimum={settings.characterEnergyRegenMinimums[catalog.id] ?? 0} onSave={saveSubstatWeights} onReset={resetSubstatWeights} onClose={() => setScoreEditorOpen(false)}/>}
    {scoreInfoOpen && createPortal(<div className={`modal-backdrop roll-quality-backdrop cs-element-${catalog.element.toLowerCase()}`} onMouseDown={() => setScoreInfoOpen(false)}><Panel className="roll-quality-modal cs-score-info-modal" role="dialog" aria-modal="true" aria-labelledby="substat-score-info-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">Character-specific Echo evaluation</span><h2 id="substat-score-info-title">How Substat Score works</h2></div><button className="close" aria-label="Close Substat Score information" onClick={() => setScoreInfoOpen(false)}>×</button></header>
      <div className="roll-quality-scroll">
      <p>Substat Score measures how useful an Echo's revealed rolls are for {catalog.name}. Unlike Roll Grade, it values the stats this character actually wants.</p>
      <section><h3>1. Find the roll tier</h3><p>Percentage substats earn 1–8 tier points from their position among the eight fixed in-game roll values. Flat HP, ATK, and DEF use 3 tier points.</p><div className="roll-tier-legend"><span className="tier-low">1–2 Low</span><span className="tier-mid">3–4 Mid</span><span className="tier-high">5–6 High</span><span className="tier-perfect">7–8 Elite</span></div></section>
      <section><h3>2. Apply this character's priority</h3><p>Every configured stat has a character-specific weight. Energy Regen is excluded and instead uses the configured minimum requirement.</p><div className="score-weight-legend"><span className="weight-4">4 Highest</span><span className="weight-3">3 Strong</span><span className="weight-2">2 Useful</span><span className="weight-1">1 Marginal</span></div><div className="quality-formula"><b>Roll tier</b><span>×</span><b>Character weight</b><span>= contribution</span></div></section>
      <section><h3>3. Normalize the total</h3><p>Each ER substat is removed from both the earned points and the 25-roll denominator. If total ER is below the configured minimum, the earned build grade drops by one tier. Fewer than five revealed substats produce a provisional score marked with an asterisk.</p><div className="quality-formula"><b>Earned non-ER points</b><span>÷</span><b>25 minus ER rolls</b><span>= score %</span></div><div className="score-grade-legend"><span className="grade-e">E<small>0–14.9%</small></span><span className="grade-d">D<small>15–24.9%</small></span><span className="grade-c">C<small>25–34.9%</small></span><span className="grade-b">B<small>35–44.9%</small></span><span className="grade-a">A<small>45–54.9%</small></span><span className="grade-s">S<small>55–64.9%</small></span><span className="grade-ss">SS<small>65–74.9%</small></span><span className="grade-sss">SSS<small>75–100%</small></span></div></section>
      </div>
    </Panel></div>, document.body)}
  </section></CharacterSubstatProfileContext.Provider>
}

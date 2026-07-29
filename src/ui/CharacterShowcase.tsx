import { useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { toPng } from 'html-to-image'
import { baseTuneBreakBoost, characterCatalog, sonataNames, statLabels, weaponCatalog, type CharacterCatalogEntry, type WeaponCatalogEntry } from '../game-data'
import { characterSubstatScoreKeys } from '../game-data/character-substat-preferences'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { effectiveSubStats } from '../game-data/echo-main-stats'
import { echoRollRating } from '../domain/echo-grade'
import { resolveCharacterSubstatProfile, scoreCharacterSubstats } from '../domain/character-substat-score'
import { createLocalId } from '../domain/id'
import { db, saveSettings, setBuildEchoIds, setOwnedWeaponOwner } from '../storage/database'
import type { AggregatedStats, AppSettings, Build, Echo, OwnedCharacter, OwnedWeapon, StatKey } from '../domain/types'
import { CharacterSubstatProfileContext, EchoMiniCard, Icon, Panel } from './components'
import { EchoWaveform } from './EchoWaveform'
import { EchoEditModal } from './EchoEditModal'
import { NanokaSpinePortrait, type NanokaSpinePortraitHandle } from './NanokaSpinePortrait'
import { CalculatedValue, type CalculationDetail } from './CalculationDetails'
import { showcaseStatDetail } from './calculation-detail-model'
import { defaultEnabledSkillTreeBonusIds, inherentSkillBonusId, resolveCharacterShowcaseModel, skillTreeBonusId } from './character-showcase-model'
import './character-showcase.css'

const LEVELS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90]
const SKILLS = [
  ['normalAttack', 'Normal Attack'],
  ['resonanceSkill', 'Resonance Skill'],
  ['forteCircuit', 'Forte Circuit'],
  ['resonanceLiberation', 'Resonance Liberation'],
  ['introSkill', 'Intro Skill']
] as const
const ELEMENT_ACCENTS: Record<string, string> = { Spectro: '#e8cc72', Fusion: '#ee715e', Glacio: '#76cef2', Electro: '#b581ef', Aero: '#62d7ae', Havoc: '#d36adf' }
type ShowcaseStatKey = StatKey | 'tuneBreakBoost'

interface CharacterShowcaseProps {
  character: OwnedCharacter
  catalog: CharacterCatalogEntry
  weapons: OwnedWeapon[]
  echoes: Echo[]
  builds: Build[]
  settings: AppSettings
  refresh: () => Promise<void>
  onBack: () => void
}

function Stars({ rarity }: { rarity: number }) {
  return <span className="cs-stars" aria-label={`${rarity} star rarity`}>{'★'.repeat(rarity)}</span>
}

function StatIcon({ stat }: { stat: ShowcaseStatKey }) {
  const iconNames: Partial<Record<ShowcaseStatKey, string>> = {
    hp: 'Icon_Attribute_Health.webp', atk: 'Icon_Attribute_Attack.webp', def: 'Icon_Attribute_Defense.webp',
    critRate: 'Icon_Attribute_Crit_Rate.webp', critDamage: 'Icon_Attribute_Crit_DMG.webp', energyRegen: 'Icon_Attribute_Energy_Regen.webp',
    healingBonus: 'Icon_Attribute_Healing.webp', basicDamage: 'Icon_Basic_Attack_DMG_Amplification.webp',
    heavyDamage: 'Icon_Heavy_Attack_DMG_Amplification.webp', skillDamage: 'Icon_Resonance_Skill_DMG_Amplification.webp',
    liberationDamage: 'Icon_Resonance_Liberation_DMG_Amplification.webp', glacioDamage: 'Icon_Glacio_DMG_Bonus.webp',
    fusionDamage: 'Icon_Fusion_DMG_Bonus.webp', electroDamage: 'Icon_Electro_DMG_Bonus.webp', aeroDamage: 'Icon_Aero_DMG_Bonus.webp',
    spectroDamage: 'Icon_Spectro_DMG_Bonus.webp', havocDamage: 'Icon_Havoc_DMG_Bonus.webp',
    tuneBreakBoost: 'Icon_Attribute_Tune_Break_Boost.webp'
  }
  return <img className="cs-stat-icon" src={`https://wuwa-optimizer.com/images/icons/${iconNames[stat] ?? 'Icon_Attribute_Attack.webp'}`} alt="" aria-hidden="true"/>
}

function formatStat(key: ShowcaseStatKey, value: number) {
  return key === 'hp' || key === 'atk' || key === 'def'
    ? Math.floor(value + 1e-9).toLocaleString('en-US')
    : key === 'tuneBreakBoost' ? value.toFixed(1)
    : `${value.toFixed(1)}%`
}

function displayedStatValue(stats: AggregatedStats, key: ShowcaseStatKey, catalog: CharacterCatalogEntry) {
  if (key === 'tuneBreakBoost') return baseTuneBreakBoost(catalog)
  return key in stats ? stats[key as keyof typeof stats] : 0
}

function cleanSkillDescription(description: string) {
  return description
    .replace(/<[^>]*>/g, '')
    .replace(/\{Cus:[^}]*\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function EchoShowcaseCard({ echo, index, element, editing, onOpen, onEdit }: { echo?: Echo; index: number; element: string; editing: boolean; onOpen: () => void; onEdit: (echo: Echo) => void }) {
  const style = { '--cs-accent': ELEMENT_ACCENTS[element] ?? '#e4bb5e' } as CSSProperties
  if (!echo) return <article className={`cs-echo-card cs-echo-empty ${editing ? 'is-editable' : ''}`} style={style} onClick={editing ? onOpen : undefined} role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined}>
    <div className="cs-empty-mark">+</div><strong>Empty Echo slot</strong><small>{editing ? 'Select to equip' : `Slot ${index + 1}`}</small><EchoWaveform element={element}/>
  </article>
  const rating = echoRollRating(echo)
  return <div className={`cs-echo-tab-card ${editing ? 'is-editable' : ''}`} style={style}>
    <EchoMiniCard echo={echo} rollRating={rating} onClick={editing ? onOpen : undefined} actions={editing ? <div className="cs-echo-footer-actions"><button title="Edit Echo" aria-label={`Edit ${echo.name}`} onClick={(event) => { event.stopPropagation(); onEdit(echo) }}><Icon name="edit"/></button><button className="cs-switch-echo" title="Switch Echo" aria-label={`Switch ${echo.name}`} onClick={(event) => { event.stopPropagation(); onOpen() }}>↔</button></div> : undefined}/>
  </div>
}

function EchoFilterSelect({ label, values, options, emptyLabel, onChange, icon }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; emptyLabel: string; onChange: (values: string[]) => void; icon?: (value: string) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  return <label className="multi-filter">{label}<div className="multi-select"><button type="button" className="multi-select-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="multi-select-values">{values.length ? values.map((value) => <span className="multi-select-chip" key={value}>{icon?.(value)}<b>{options.find((option) => option.value === value)?.label ?? value}</b></span>) : <em>{emptyLabel}</em>}</span><strong>⌄</strong></button>{open && <div className="multi-select-menu"><div className="multi-select-options">{options.map((option) => <button type="button" className={values.includes(option.value) ? 'active' : ''} onClick={() => toggle(option.value)} key={option.value}>{icon?.(option.value)}<span>{option.label}</span><i>{values.includes(option.value) ? '✓' : ''}</i></button>)}</div><footer><button type="button" className="multi-select-clear" disabled={!values.length} onClick={() => onChange([])}>Clear selections</button></footer></div>}</div></label>
}

function WeaponPicker({ character, catalog, weapons, refresh, onClose }: { character: OwnedCharacter; catalog: CharacterCatalogEntry; weapons: OwnedWeapon[]; refresh: () => Promise<void>; onClose: () => void }) {
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
  return <div className="catalog-picker-backdrop cs-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="catalog-picker cs-picker" role="dialog" aria-modal="true" aria-label="Equip weapon"><header><div><span className="eyebrow">{catalog.weaponType} inventory</span><h2>{adding ? 'Add and equip weapon' : 'Equip weapon'}</h2></div><div>{adding && <button className="secondary" onClick={() => setAdding(false)}>Owned</button>}<button className="text-button" onClick={onClose}>Close</button></div></header><div className="catalog-picker-grid">
    {!adding && eligibleOwned.map(({ owned, entry }) => <button className={`catalog-choice weapon-choice rarity-${entry.rarity}`} key={owned.id} onClick={() => void equip(owned)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>Lv. {owned.level} · R{owned.rank}</small><Stars rarity={entry.rarity}/>{owned.equippedBy && owned.equippedBy !== character.id && <em>Currently equipped elsewhere</em>}</span></button>)}
    {!adding && <button className="catalog-choice add-owned-choice" onClick={() => setAdding(true)}><span className="add-glyph">+</span><span><strong>Add weapon</strong><small>Create a local copy and equip it.</small></span></button>}
    {adding && eligibleCatalog.map((entry) => <button className={`catalog-choice weapon-choice rarity-${entry.rarity}`} key={entry.id} onClick={() => void add(entry)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>{entry.type}</small><Stars rarity={entry.rarity}/></span></button>)}
  </div></section></div>
}

function EchoPicker({ slot, build, echoes, refresh, onClose }: { slot: number; build: Build; echoes: Echo[]; refresh: () => Promise<void>; onClose: () => void }) {
  const characterSubstatProfile = useContext(CharacterSubstatProfileContext)
  const currentId = build.echoIds[slot]
  const [query, setQuery] = useState('')
  const [costs, setCosts] = useState<number[]>([])
  const [rarities, setRarities] = useState<number[]>([])
  const [sonatas, setSonatas] = useState<string[]>([])
  const [mainStats, setMainStats] = useState<string[]>([])
  const [subStats, setSubStats] = useState<string[]>([])
  const [lockState, setLockState] = useState<'all' | 'locked' | 'unlocked'>('all')
  const [assignment, setAssignment] = useState<'all' | 'equipped' | 'unequipped'>('all')
  const [showExcluded, setShowExcluded] = useState(false)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const statKeys = Object.keys(statLabels) as StatKey[]
  const toggleNumber = (values: number[], value: number, change: (next: number[]) => void) => change(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  const resetFilters = () => { setQuery(''); setCosts([]); setRarities([]); setSonatas([]); setMainStats([]); setSubStats([]); setLockState('all'); setAssignment('all'); setShowExcluded(false) }
  const options = useMemo(() => echoes.filter((echo) =>
    (showExcluded || !echo.excluded) &&
    (!echo.equippedBy || echo.equippedBy === build.id) &&
    (!costs.length || costs.includes(echo.cost)) &&
    (!rarities.length || rarities.includes(echo.rarity)) &&
    (!sonatas.length || sonatas.includes(echo.sonata)) &&
    (!mainStats.length || mainStats.includes(echo.mainStat.key)) &&
    (!subStats.length || subStats.every((key) => effectiveSubStats(echo).some((stat) => stat.key === key))) &&
    (lockState === 'all' || echo.locked === (lockState === 'locked')) &&
    (assignment === 'all' || Boolean(echo.equippedBy) === (assignment === 'equipped')) &&
    (!deferredQuery || `${echo.name} ${echo.sonata} ${statLabels[echo.mainStat.key]} ${effectiveSubStats(echo).map((stat) => statLabels[stat.key]).join(' ')}`.toLowerCase().includes(deferredQuery))
  ).sort((left, right) => {
    if (characterSubstatProfile) {
      return scoreCharacterSubstats(right, characterSubstatProfile).percentage - scoreCharacterSubstats(left, characterSubstatProfile).percentage
        || left.name.localeCompare(right.name)
    }
    return echoRollRating(right).average - echoRollRating(left).average || left.name.localeCompare(right.name)
  }), [assignment, build.id, characterSubstatProfile, costs, deferredQuery, echoes, lockState, mainStats, rarities, showExcluded, sonatas, subStats])
  const choose = async (next?: Echo) => {
    const oldId = build.echoIds[slot]
    const echoIds = [...build.echoIds]
    if (next) {
      const duplicateSlot = echoIds.indexOf(next.id)
      if (duplicateSlot >= 0 && duplicateSlot !== slot) return
      if (slot < echoIds.length) echoIds[slot] = next.id
      else echoIds.push(next.id)
    } else if (oldId) echoIds.splice(slot, 1)
    const cost = echoIds.reduce((total, id) => total + (echoes.find((echo) => echo.id === id)?.cost ?? 0), 0)
    if (echoIds.length > 5 || cost > 12) return
    await setBuildEchoIds(build.id, echoIds)
    await refresh()
    onClose()
  }
  return <div className="catalog-picker-backdrop cs-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="catalog-picker cs-picker cs-echo-picker" role="dialog" aria-modal="true" aria-label={`Equip Echo slot ${slot + 1}`}><header><div><span className="eyebrow">Echo slot {slot + 1}</span><h2>Equip Echo</h2></div><button className="text-button" onClick={onClose}>Close</button></header><div className="cs-echo-picker-filters"><div className="filter-heading"><div><strong>Echo filters</strong><span>{options.length} / {echoes.length} shown</span></div><button className="text-button" onClick={resetFilters}>Reset</button></div><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Echo, Sonata, or stat..."/></label><div className="filter-body"><div className="filter-group"><span>Cost</span><div className="filter-chips">{[1,3,4].map((value) => <button className={costs.includes(value) ? 'active' : ''} onClick={() => toggleNumber(costs, value, setCosts)} key={value}>{value} cost</button>)}</div></div><div className="filter-group"><span>Rarity</span><div className="filter-chips">{[5,4,3,2,1].map((value) => <button className={rarities.includes(value) ? 'active' : ''} onClick={() => toggleNumber(rarities, value, setRarities)} key={value}>{value} ★</button>)}</div></div><EchoFilterSelect label="Sonata" values={sonatas} options={sonataNames.map((name) => ({ value: name, label: name }))} emptyLabel="All Sonatas" onChange={setSonatas} icon={(name) => <img src={generatedSonataIconSources[name]} alt=""/>}/><EchoFilterSelect label="Main stat" values={mainStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any main stat" onChange={setMainStats}/><EchoFilterSelect label="Substat" values={subStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any substat" onChange={setSubStats}/><label>Lock state<select value={lockState} onChange={(event) => setLockState(event.target.value as typeof lockState)}><option value="all">All</option><option value="locked">Locked</option><option value="unlocked">Unlocked</option></select></label><label>Equipped<select value={assignment} onChange={(event) => setAssignment(event.target.value as typeof assignment)}><option value="all">All</option><option value="equipped">Equipped here</option><option value="unequipped">Unequipped</option></select></label><label className="check"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}/>Include discarded</label></div></div><div className="echo-picker-list">{currentId && <button className="danger" onClick={() => void choose()}>Unequip current Echo</button>}{options.map((echo) => <EchoMiniCard key={echo.id} echo={echo} selected={echo.id === currentId} rollRating={echoRollRating(echo)} onClick={() => void choose(echo)}/>)}</div></section></div>
}

function SubstatWeightEditor({ characterName, initialWeights, recommendedWeights, onSave, onReset, onClose }: {
  characterName: string
  initialWeights: Partial<Record<StatKey, number>>
  recommendedWeights: Partial<Record<StatKey, number>>
  onSave: (weights: Partial<Record<StatKey, number>>) => Promise<void>
  onReset: () => Promise<void>
  onClose: () => void
}) {
  const [weights, setWeights] = useState<Partial<Record<StatKey, number>>>(() => ({ ...initialWeights }))
  const [saving, setSaving] = useState(false)
  const setWeight = (key: StatKey, value: number) => setWeights((current) => ({ ...current, [key]: Math.min(4, Math.max(0, value)) }))
  const submit = async () => {
    setSaving(true)
    try {
      await onSave(Object.fromEntries(characterSubstatScoreKeys.flatMap((key) => {
        const weight = Math.round(weights[key] ?? 0)
        return weight > 0 ? [[key, weight]] : []
      })))
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
  return <div className="modal-backdrop cs-weight-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><Panel className="cs-weight-editor" role="dialog" aria-modal="true" aria-labelledby="substat-weight-editor-title">
    <header><div><span className="eyebrow">Character substat priorities</span><h2 id="substat-weight-editor-title">Configure {characterName}</h2></div><button type="button" className="close" aria-label="Close substat priority editor" onClick={onClose}>×</button></header>
    <p>Set a priority from 0 to 4. A stat at 0 is ignored; higher priorities award more points for each roll tier.</p>
    <div className="cs-weight-grid">{characterSubstatScoreKeys.map((key) => <label key={key}><span>{statLabels[key]}<small>Recommended: {recommendedWeights[key] ?? 0}</small></span><div><button type="button" aria-label={`Decrease ${statLabels[key]} priority`} disabled={(weights[key] ?? 0) <= 0} onClick={() => setWeight(key, (weights[key] ?? 0) - 1)}>−</button><input aria-label={`${statLabels[key]} priority`} type="number" min="0" max="4" step="1" value={weights[key] ?? 0} onChange={(event) => setWeight(key, Math.round(Number(event.target.value) || 0))}/><button type="button" aria-label={`Increase ${statLabels[key]} priority`} disabled={(weights[key] ?? 0) >= 4} onClick={() => setWeight(key, (weights[key] ?? 0) + 1)}>+</button></div></label>)}</div>
    <footer><button type="button" className="secondary" disabled={saving} onClick={() => void reset()}>Reset to recommended</button><div><button type="button" className="text-button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving...' : 'Save priorities'}</button></div></footer>
  </Panel></div>
}

export function CharacterShowcase({ character, catalog, weapons, echoes, builds, settings, refresh, onBack }: CharacterShowcaseProps) {
  const [editing, setEditing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [weaponPickerOpen, setWeaponPickerOpen] = useState(false)
  const [echoSlot, setEchoSlot] = useState<number | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [portraitFailed, setPortraitFailed] = useState(false)
  const [animatedPortraitReady, setAnimatedPortraitReady] = useState(false)
  const [openSkillTooltip, setOpenSkillTooltip] = useState<string | null>(null)
  const [editingEcho, setEditingEcho] = useState<Echo | null>(null)
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false)
  const [scoreEditorOpen, setScoreEditorOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const portraitRef = useRef<HTMLImageElement>(null)
  const livePortraitRef = useRef<NanokaSpinePortraitHandle>(null)
  const showAnimatedPortrait = useCallback(() => setAnimatedPortraitReady(true), [])
  const showStaticPortrait = useCallback(() => setAnimatedPortraitReady(false), [])

  useEffect(() => {
    setPortraitFailed(false)
    setAnimatedPortraitReady(false)
  }, [catalog.id])

  const model = resolveCharacterShowcaseModel({ character, catalog, weapons, echoes, builds })
  if (!model) return null
  const customSubstatWeights = settings.characterSubstatWeights[catalog.id]
  const recommendedSubstatProfile = resolveCharacterSubstatProfile(catalog)
  const characterSubstatProfile = resolveCharacterSubstatProfile(catalog, customSubstatWeights)
  const preferredSubstats = (Object.entries(characterSubstatProfile.weights) as Array<[StatKey, number]>)
    .filter(([, weight]) => weight > 0)
    .sort((left, right) => right[1] - left[1] || statLabels[left[0]].localeCompare(statLabels[right[0]]))

  const elementStat = `${catalog.element.toLowerCase()}Damage` as StatKey
  const statRows: Array<[ShowcaseStatKey, string]> = [
    ['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['critRate', 'Crit. Rate'], ['critDamage', 'Crit. DMG'], ['energyRegen', 'Energy Regen'],
    ['healingBonus', 'Healing Bonus'], ['tuneBreakBoost', 'Tune Break Boost'], [elementStat, `${catalog.element} DMG`], ['basicDamage', 'Basic Attack DMG'], ['heavyDamage', 'Heavy Attack DMG'],
    ['skillDamage', 'Resonance Skill DMG'], ['liberationDamage', 'Resonance Liberation DMG']
  ]
  const updateCharacter = async (patch: Partial<OwnedCharacter>) => {
    await db.transaction('rw', db.characters, db.builds, async () => {
      await db.characters.update(character.id, patch)
      if (patch.level !== undefined && model.build) await db.builds.update(model.build.id, { level: patch.level })
      if (patch.skillLevels && model.build) await db.builds.update(model.build.id, { skillLevel: patch.skillLevels[1] })
    })
    await refresh()
  }
  const openEchoPicker = async (slot: number) => {
    if (!model.build) {
      await db.builds.add({ id: createLocalId(), name: `${catalog.name} build`, resonatorId: character.catalogId, weaponId: '', echoIds: [], level: character.level, skillLevel: model.skillLevels[1] })
      await refresh()
    }
    setEchoSlot(slot)
  }
  const removeCharacter = async () => {
    if (!deleteArmed) { setDeleteArmed(true); return }
    await db.transaction('rw', db.characters, db.weapons, db.echoes, db.builds, db.teams, async () => {
      await db.characters.delete(character.id)
      await db.weapons.where('equippedBy').equals(character.id).modify({ equippedBy: undefined })
      if (model.build) {
        await db.echoes.where('equippedBy').equals(model.build.id).modify({ equippedBy: undefined })
        await db.teams.toCollection().modify((team) => { team.buildIds = team.buildIds.filter((id) => id !== model.build?.id) })
        await db.builds.delete(model.build.id)
      }
    })
    await refresh()
    onBack()
  }
  const currentBuild = builds.find((entry) => entry.resonatorId === character.catalogId)
  const innateTuneBreakBoost = baseTuneBreakBoost(catalog)
  const statDetail = (key: ShowcaseStatKey, label: string): CalculationDetail => key === 'tuneBreakBoost'
    ? { title: label, value: innateTuneBreakBoost.toFixed(1), formula: 'Character Tune Break baseline', rows: [{ label: 'Base Tune Break Boost', value: innateTuneBreakBoost.toFixed(1) }] }
    : showcaseStatDetail(model, key, label)
  const toggleSkillTooltip = (id: string) => setOpenSkillTooltip((current) => current === id ? null : id)
  const exportCharacterCard = async () => {
    const frame = exportRef.current
    if (!frame || exporting) return
    setExporting(true)
    setExportMessage('')
    setOpenSkillTooltip(null)
    let originalPortraitSource: string | undefined
    let exportHost: HTMLDivElement | undefined
    try {
      const livePortraitSnapshot = animatedPortraitReady ? livePortraitRef.current?.captureFrame() : undefined
      if (portraitRef.current) {
        try {
          originalPortraitSource = await inlineImageSource(portraitRef.current)
        } catch {
          await portraitRef.current.decode().catch(() => undefined)
        }
      }

      const exportFrame = frame.cloneNode(true) as HTMLDivElement
      const frameStyles = getComputedStyle(frame)
      for (const property of ['--cs-accent', '--cs-accent-rgb']) {
        exportFrame.style.setProperty(property, frameStyles.getPropertyValue(property))
      }
      exportFrame.classList.add('is-exporting')
      const snapshotImage = exportFrame.querySelector<HTMLImageElement>('.cs-live-portrait-snapshot')
      if (livePortraitSnapshot && snapshotImage) {
        snapshotImage.src = livePortraitSnapshot
        exportFrame.classList.add('has-live-portrait-snapshot')
      }
      exportHost = document.createElement('div')
      exportHost.style.position = 'fixed'
      exportHost.style.left = '-100000px'
      exportHost.style.top = '0'
      exportHost.style.width = '1600px'
      exportHost.style.pointerEvents = 'none'
      exportHost.style.zIndex = '-1'
      exportHost.append(exportFrame)
      document.body.append(exportHost)
      if (snapshotImage?.src) await snapshotImage.decode()
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const exportHeight = Math.ceil(exportFrame.scrollHeight)
      const dataUrl = await toPng(exportFrame, {
        width: 1600,
        height: exportHeight,
        pixelRatio: 1.5,
        cacheBust: true,
        backgroundColor: '#030708',
        style: { width: '1600px', height: `${exportHeight}px`, maxWidth: 'none' }
      })
      const anchor = document.createElement('a')
      anchor.download = `${catalog.name.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-character-card.png`
      anchor.href = dataUrl
      anchor.click()
      setExportMessage('Character card exported as a high-resolution PNG.')
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
    if (enabled.has(id)) enabled.delete(id)
    else enabled.add(id)
    await updateCharacter({ enabledSkillTreeBonusIds: [...enabled].sort() })
  }
  const saveSubstatWeights = async (weights: Partial<Record<StatKey, number>>) => {
    await saveSettings({
      ...settings,
      characterSubstatWeights: { ...settings.characterSubstatWeights, [catalog.id]: weights }
    })
    await refresh()
  }
  const resetSubstatWeights = async () => {
    const characterSubstatWeights = { ...settings.characterSubstatWeights }
    delete characterSubstatWeights[catalog.id]
    await saveSettings({ ...settings, characterSubstatWeights })
    await refresh()
  }

  return <CharacterSubstatProfileContext.Provider value={characterSubstatProfile}><section className={`cs-page cs-element-${catalog.element.toLowerCase()}`}>
    <header className="cs-toolbar"><button className="cs-back" onClick={onBack}>← Back to roster</button><div><span className="eyebrow">Character showcase</span><strong>{catalog.name}</strong></div><div className={`cs-toolbar-actions ${editing ? 'is-editing' : ''}`}>{editing && <><button className={character.favorite ? 'cs-favorite active' : 'cs-favorite'} onClick={() => void updateCharacter({ favorite: !character.favorite })}>{character.favorite ? '♥ Favorited' : '♡ Favorite'}</button><button className={`danger ${deleteArmed ? 'is-armed' : ''}`} onClick={() => void removeCharacter()}><Icon name="trash"/>{deleteArmed ? 'Confirm delete' : 'Delete'}</button></>}<button className="secondary cs-export-button" disabled={exporting} onClick={() => void exportCharacterCard()}><Icon name="download"/><span>{exporting ? 'Rendering...' : 'Export image'}</span></button><button className={editing ? 'primary' : 'secondary'} onClick={() => { setEditing(!editing); setDeleteArmed(false) }}>{editing ? 'Done editing' : 'Edit loadout'}</button></div></header>
    {exportMessage && <div className={`cs-export-message ${exportMessage.startsWith('Image export failed') ? 'is-error' : ''}`} role="status">{exportMessage}</div>}

    <div className="cs-export-frame" ref={exportRef}>
    <header className="cs-export-masthead"><div><span>Tacet Lab</span><strong>Character dossier</strong></div><div><b>{catalog.name}</b><small>{catalog.element} / {catalog.weaponType} / {catalog.role}</small></div></header>
    <div className="cs-layout">
      <section className="cs-character-panel cs-panel">
        <div className="cs-art-grid"/>
        <img
          ref={portraitRef}
          className={`cs-character-art ${portraitFailed ? 'is-fallback' : ''} ${animatedPortraitReady ? 'is-live-hidden' : ''}`}
          src={portraitFailed ? catalog.iconSourceUrl : (catalog.portraitSourceUrl || catalog.iconSourceUrl)}
          alt={catalog.name}
          onError={() => {
            if (!portraitFailed && catalog.portraitSourceUrl && catalog.portraitSourceUrl !== catalog.iconSourceUrl) setPortraitFailed(true)
          }}
        />
        <img className="cs-live-portrait-snapshot" alt="" aria-hidden="true"/>
        {catalog.spineSkeletonSourceUrl && catalog.spineAtlasSourceUrl && <NanokaSpinePortrait
          ref={livePortraitRef}
          skeletonSourceUrl={catalog.spineSkeletonSourceUrl}
          atlasSourceUrl={catalog.spineAtlasSourceUrl}
          onReady={showAnimatedPortrait}
          onFallback={showStaticPortrait}
        />}
        <div className="cs-sequence-rail" aria-label={`Sequence ${character.sequence}`}>{catalog.sequenceIcons.slice(0, 6).map((sequence) => <button key={sequence.sequence} className={character.sequence >= sequence.sequence ? 'is-unlocked' : 'is-locked'} onClick={() => void updateCharacter({ sequence: character.sequence === sequence.sequence ? sequence.sequence - 1 : sequence.sequence })}><img src={sequence.iconSourceUrl} alt=""/><span>S{sequence.sequence}</span><span className="cs-skill-tooltip"><b>S{sequence.sequence} · {sequence.name}</b><small>{richSkillDescription(sequence.description)}</small></span></button>)}</div>
        <div className="cs-character-copy"><h1>{catalog.name}</h1><p>{catalog.title}</p><div className="cs-level-rarity"><strong>Lv. {character.level}</strong><Stars rarity={catalog.rarity}/></div><div className="cs-character-kicker"><span>{catalog.element}</span><span>{catalog.weaponType}</span><span>{catalog.role}</span></div>{editing && <div className="cs-level-editor" aria-label="Character level">{LEVELS.map((level) => <button key={level} className={character.level === level ? 'active' : ''} onClick={() => void updateCharacter({ level })}>{level}</button>)}</div>}</div>
        <div className="cs-sonatas">{model.sonatas.length ? model.sonatas.map((sonata) => <span key={sonata.name}>{sonata.iconSourceUrl && <img src={sonata.iconSourceUrl} alt=""/>}<b>{sonata.name}</b><small>{sonata.count}</small></span>) : <span className="is-empty"><b>No active Sonata</b><small>0</small></span>}</div>
        <EchoWaveform element={catalog.element}/>
      </section>

      <section className="cs-stats-panel cs-panel"><header><div><span className="eyebrow">Resonator statistics</span><h2>Current attributes</h2></div><span>Lv. {model.characterBaseStats.level}</span></header><div className="cs-stat-list">{statRows.map(([key, label]) => <div key={key}><StatIcon stat={key}/><span>{label}</span><i/><CalculatedValue detail={statDetail(key, label)}><b>{formatStat(key, displayedStatValue(model.finalStats, key, catalog))}</b></CalculatedValue></div>)}</div><p className="cs-warning">{model.warning}</p></section>

      <section className={`cs-weapon-panel cs-panel ${editing ? 'is-editable' : ''}`} onClick={editing ? () => setWeaponPickerOpen(true) : undefined} role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined}>
        {model.weapon ? <><div className="cs-weapon-copy"><span className="eyebrow">Equipped weapon</span><div className="cs-weapon-title"><h2>{model.weapon.catalog.name}</h2><b>LV. {model.weapon.owned.level} · R{model.weapon.owned.rank}</b></div><Stars rarity={model.weapon.catalog.rarity}/><div><span>Base ATK</span><b>{model.weapon.levelStats.baseAtk}</b></div><div><span>{model.weapon.catalog.secondaryStat}</span><b>{model.weapon.levelStats.secondaryStatValue}</b></div>{editing && <small>Select to replace</small>}</div><img src={model.weapon.catalog.iconSourceUrl} alt=""/></> : <div className="cs-empty-weapon"><span>+</span><strong>No weapon equipped</strong><small>{editing ? `Select a ${catalog.weaponType}` : catalog.weaponType}</small></div>}
        <EchoWaveform element={catalog.element}/>
      </section>

      <section className="cs-skills-panel cs-panel"><header><div><span className="eyebrow">Forte circuit</span><h2>Skill levels</h2></div>{editing && <small>Adjust levels</small>}</header><div className="cs-source-skill-tree">
        {SKILLS.map(([key, label], index) => {
          const skill = catalog.skillIcons[key]
          if (index === 2) return <div className="cs-skill-branch cs-skill-special" key={key}>
            {catalog.skillTreeExtras.inherentSkills.map((extra, sourceIndex) => ({ extra, id: inherentSkillBonusId(sourceIndex) })).reverse().map(({ extra, id }) => { const enabled = enabledSkillTreeNodeIds.includes(id); return <div className="cs-special-step" key={id}><button type="button" className={`cs-node-tooltip-anchor cs-inherent-toggle ${enabled ? 'is-enabled' : 'is-disabled'}`} aria-pressed={enabled} aria-label={`${extra.name}, ${enabled ? 'enabled' : 'disabled'}. Click to ${enabled ? 'disable' : 'enable'}. ${cleanSkillDescription(extra.description)}`} onClick={() => { toggleSkillTooltip(id); void toggleSkillTreeNode(id) }}><div className="cs-skill-small-diamond"><img src={extra.iconSourceUrl} alt=""/></div>{openSkillTooltip === id && <span className="cs-skill-tooltip"><b>{extra.name}</b><small>{richSkillDescription(extra.description)}</small></span>}</button><i/></div> })}
            <div className={`cs-main-skill ${openSkillTooltip === `main-${key}` ? 'is-tooltip-open' : ''}`} tabIndex={0} aria-label={`${skill.name}. ${cleanSkillDescription(skill.description)}`} aria-expanded={openSkillTooltip === `main-${key}`} onClick={() => toggleSkillTooltip(`main-${key}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSkillTooltip(`main-${key}`) } }}><div className="cs-skill-diamond"><span><img src={skill.iconSourceUrl} alt=""/></span></div>{openSkillTooltip === `main-${key}` && <span className="cs-skill-tooltip"><b>{skill.name}</b><small>{richSkillDescription(skill.description)}</small></span>}<div className="cs-skill-level">{editing && <button disabled={model.skillLevels[index] <= 1} onClick={(event) => { event.stopPropagation(); const levels = [...model.skillLevels] as [number, number, number, number, number]; levels[index] -= 1; void updateCharacter({ skillLevels: levels }) }}>−</button>}<b>Lv. {model.skillLevels[index]}</b>{editing && <button disabled={model.skillLevels[index] >= 10} onClick={(event) => { event.stopPropagation(); const levels = [...model.skillLevels] as [number, number, number, number, number]; levels[index] += 1; void updateCharacter({ skillLevels: levels }) }}>+</button>}</div><strong>{label}</strong></div>
            <div className="cs-special-tail">{[catalog.skillTreeExtras.outroSkill, catalog.skillTreeExtras.tuneBreakSkill].map((extra, extraIndex) => { const tooltipId = `bottom-${extraIndex}`; return extra?.iconSourceUrl && <div className={`cs-node-tooltip-anchor ${openSkillTooltip === tooltipId ? 'is-tooltip-open' : ''}`} tabIndex={0} aria-label={`${extra.name}. ${cleanSkillDescription(extra.description)}`} aria-expanded={openSkillTooltip === tooltipId} onClick={() => toggleSkillTooltip(tooltipId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSkillTooltip(tooltipId) } }} key={`${extra.name}-${extraIndex}`}><div className="cs-skill-small-diamond"><img src={extra.iconSourceUrl} alt=""/></div>{openSkillTooltip === tooltipId && <span className="cs-skill-tooltip"><b>{extra.name}</b><small>{richSkillDescription(extra.description)}</small></span>}</div> })}</div>
          </div>
          const bonuses = catalog.skillTreeExtras.bonusStatBranches[key]
            .map((bonus, sourceIndex) => ({ bonus, id: skillTreeBonusId(key, sourceIndex) }))
            .reverse()
          return <div className={`cs-skill-branch cs-skill-side cs-skill-side-${index}`} key={key}>
            {bonuses.map(({ bonus, id }) => { const enabled = enabledSkillTreeNodeIds.includes(id); return <div className="cs-bonus-step" key={id}><button type="button" className={`cs-skill-bonus ${enabled ? 'is-enabled' : 'is-disabled'}`} aria-pressed={enabled} aria-label={`${bonus.name}, ${enabled ? 'enabled' : 'disabled'}. Click to ${enabled ? 'disable' : 'enable'}. ${cleanSkillDescription(bonus.description)}`} onClick={() => void toggleSkillTreeNode(id)}><img src={bonus.iconSourceUrl} alt=""/><span className="cs-skill-tooltip"><b>{bonus.name.replace(/\+$/, ' %')}</b><small>{richSkillDescription(bonus.description)}</small></span></button><i/></div> })}
            <div className={`cs-main-skill ${openSkillTooltip === `main-${key}` ? 'is-tooltip-open' : ''}`} tabIndex={0} aria-label={`${skill.name}. ${cleanSkillDescription(skill.description)}`} aria-expanded={openSkillTooltip === `main-${key}`} onClick={() => toggleSkillTooltip(`main-${key}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSkillTooltip(`main-${key}`) } }}><div className="cs-skill-diamond"><span><img src={skill.iconSourceUrl} alt=""/></span></div>{openSkillTooltip === `main-${key}` && <span className="cs-skill-tooltip"><b>{skill.name}</b><small>{richSkillDescription(skill.description)}</small></span>}<div className="cs-skill-level">{editing && <button disabled={model.skillLevels[index] <= 1} onClick={(event) => { event.stopPropagation(); const levels = [...model.skillLevels] as [number, number, number, number, number]; levels[index] -= 1; void updateCharacter({ skillLevels: levels }) }}>−</button>}<b>Lv. {model.skillLevels[index]}</b>{editing && <button disabled={model.skillLevels[index] >= 10} onClick={(event) => { event.stopPropagation(); const levels = [...model.skillLevels] as [number, number, number, number, number]; levels[index] += 1; void updateCharacter({ skillLevels: levels }) }}>+</button>}</div><strong>{label}</strong></div>
          </div>
        })}
      </div></section>

      <section className="cs-echo-section"><header><div><span className="eyebrow">Equipped Echoes</span><h2>Echo loadout</h2></div><span>{model.equippedEchoes.length}/5 · {model.totalEchoCost}/12 cost</span></header><div className="cs-substat-preferences"><span>Character substat priorities</span><div>{preferredSubstats.length ? preferredSubstats.map(([key, weight]) => <b className={`weight-${weight}`} key={key}>{statLabels[key]} <i>{weight}</i></b>) : <em>No stats currently receive points.</em>}</div><div className="cs-substat-actions"><button type="button" className="secondary cs-configure-score" onClick={() => setScoreEditorOpen(true)}><Icon name="settings"/>Configure</button><button type="button" className="roll-quality-help cs-score-help" onClick={() => setScoreInfoOpen(true)}>Substat score <span aria-hidden="true">ⓘ</span></button></div><small>Each substat scores roll tier × shown weight. {customSubstatWeights ? 'Using your custom priorities.' : 'Using bundled recommendations.'}</small></div><div className="cs-echo-row">{model.echoSlots.map((echo, index) => <EchoShowcaseCard key={echo?.id ?? `empty-${index}`} echo={echo} index={index} element={catalog.element} editing={editing} onOpen={() => void openEchoPicker(index)} onEdit={setEditingEcho}/>)}</div></section>
    </div>
    <footer className="cs-export-footer"><span>TACET LAB // LOCAL-FIRST BUILD ARCHIVE</span><span>{catalog.name.toUpperCase()} // LV. {character.level} // S{character.sequence}</span></footer>
    </div>

    {weaponPickerOpen && <WeaponPicker character={character} catalog={catalog} weapons={weapons} refresh={refresh} onClose={() => setWeaponPickerOpen(false)}/>}
    {echoSlot !== null && currentBuild && <EchoPicker slot={echoSlot} build={currentBuild} echoes={echoes} refresh={refresh} onClose={() => setEchoSlot(null)}/>} 
    {editingEcho && <EchoEditModal echo={editingEcho} onClose={() => setEditingEcho(null)} onSave={async (updated) => { await db.echoes.put(updated); setEditingEcho(null); await refresh() }}/>}
    {scoreEditorOpen && <SubstatWeightEditor characterName={catalog.name} initialWeights={characterSubstatProfile.weights} recommendedWeights={recommendedSubstatProfile.weights} onSave={saveSubstatWeights} onReset={resetSubstatWeights} onClose={() => setScoreEditorOpen(false)}/>}
    {scoreInfoOpen && <div className="modal-backdrop roll-quality-backdrop" onMouseDown={() => setScoreInfoOpen(false)}><Panel className="roll-quality-modal cs-score-info-modal" role="dialog" aria-modal="true" aria-labelledby="substat-score-info-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">Character-specific Echo evaluation</span><h2 id="substat-score-info-title">How Substat Score works</h2></div><button className="close" aria-label="Close Substat Score information" onClick={() => setScoreInfoOpen(false)}>×</button></header>
      <p>Substat Score measures how useful an Echo's revealed rolls are for {catalog.name}. Unlike Roll Grade, it values the stats this character actually wants.</p>
      <section><h3>1. Find the roll tier</h3><p>Percentage substats earn 1–8 tier points from their position among the eight fixed in-game roll values. Flat HP, ATK, and DEF use 3 tier points.</p><div className="roll-tier-legend"><span className="tier-low">1–2 Low</span><span className="tier-mid">3–4 Mid</span><span className="tier-high">5–6 High</span><span className="tier-perfect">7–8 Elite</span></div></section>
      <section><h3>2. Apply this character's priority</h3><p>Every configured stat has a character-specific weight. Irrelevant or unconfigured stats contribute zero points.</p><div className="score-weight-legend"><span className="weight-4">4 Highest</span><span className="weight-3">3 Strong</span><span className="weight-2">2 Useful</span><span className="weight-1">1 Marginal</span></div><div className="quality-formula"><b>Roll tier</b><span>×</span><b>Character weight</b><span>= contribution</span></div></section>
      <section><h3>3. Normalize the total</h3><p>Contributions are added and divided by the maximum configured score for this character. Fewer than five revealed substats produce a provisional score marked with an asterisk.</p><div className="quality-formula"><b>Earned weighted points</b><span>÷</span><b>Maximum weighted points</b><span>= score %</span></div><div className="score-grade-legend"><span className="grade-e">E<small>0–14.9%</small></span><span className="grade-d">D<small>15–24.9%</small></span><span className="grade-c">C<small>25–34.9%</small></span><span className="grade-b">B<small>35–44.9%</small></span><span className="grade-a">A<small>45–54.9%</small></span><span className="grade-s">S<small>55–64.9%</small></span><span className="grade-ss">SS<small>65–74.9%</small></span><span className="grade-sss">SSS<small>75–100%</small></span></div></section>
    </Panel></div>}
  </section></CharacterSubstatProfileContext.Provider>
}

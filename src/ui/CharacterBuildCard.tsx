import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { AppSettings, Echo, OwnedCharacter, StatKey } from '../domain/types'
import { scoreCharacterSubstats, type CharacterSubstatProfile } from '../domain/character-substat-score'
import { effectiveSubStats, fixedSecondaryMainStat } from '../game-data/echo-main-stats'
import { echoCatalog, sonataCatalog, statLabels, type CharacterCatalogEntry } from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { skillTreeStatLine } from '../game-data/passive-stats'
import { tunableRolls } from '../game-data/tunable-rolls'
import type { CalculationDetail } from './CalculationDetails'
import { NanokaSpinePortrait, type NanokaSpinePortraitHandle } from './NanokaSpinePortrait'
import { Icon } from './components'
import { inherentSkillBonusId, skillTreeBonusId, type CharacterShowcaseModel } from './character-showcase-model'
import './character-build-card.css'

const CARD_WIDTH = 1920
const CARD_HEIGHT = 1080
const ART_CANVAS_WIDTH = 5000
const ART_CANVAS_HEIGHT = 5000
const DEBUG_LAYOUT_STORAGE_KEY = 'tacet-lab-character-card-layout-debug-v1'
const LEVELS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90]
const SKILLS = [
  ['normalAttack', 'Normal Attack'],
  ['resonanceSkill', 'Resonance Skill'],
  ['forteCircuit', 'Forte Circuit'],
  ['resonanceLiberation', 'Resonance Liberation'],
  ['introSkill', 'Intro Skill']
] as const
const ELEMENT_ACCENTS: Record<string, string> = { Spectro: '#e8cc72', Fusion: '#ee715e', Glacio: '#76cef2', Electro: '#b581ef', Aero: '#62d7ae', Havoc: '#d36adf' }
const echoCatalogByName = new Map(echoCatalog.map((entry) => [entry.name, entry]))
const DEBUG_SECTIONS = [
  ['art', 'Character art'], ['identity', 'Identity'], ['stats', 'Stats'], ['weapon', 'Weapon'],
  ['sequences', 'Sequences'], ['skills', 'Skills'], ['echoHeader', 'Build score'],
  ['echo0', 'Main Echo'], ['echo1', 'Echo 2'], ['echo2', 'Echo 3'], ['echo3', 'Echo 4'], ['echo4', 'Echo 5'],
  ['sonatas', 'Sonatas'], ['footer', 'Footer']
] as const
type DebugSectionKey = typeof DEBUG_SECTIONS[number][0]
type EchoLayoutPreset = 'curved' | 'straight'
interface DebugSectionRect { x: number; y: number; width: number; height: number }
const ECHO_DEBUG_SECTIONS: DebugSectionKey[] = ['echo0', 'echo1', 'echo2', 'echo3', 'echo4']
const DEFAULT_CURVED_SECTION_RECTS: Partial<Record<DebugSectionKey, DebugSectionRect>> = {
  art: { x: -954, y: -500, width: 3840, height: 2160 },
  identity: { x: 19, y: 15, width: 450, height: 178 },
  stats: { x: 19, y: 201, width: 450, height: 591 },
  weapon: { x: 19, y: 802, width: 450, height: 225 },
  sequences: { x: 620, y: 23, width: 680, height: 124 },
  skills: { x: 580, y: 673, width: 760, height: 352 },
  echoHeader: { x: 1450, y: 18, width: 450, height: 120 },
  echo0: { x: 1348, y: 150, width: 450, height: 155 },
  echo1: { x: 1408, y: 310, width: 450, height: 155 },
  echo2: { x: 1468, y: 470, width: 450, height: 155 },
  echo3: { x: 1408, y: 630, width: 450, height: 155 },
  echo4: { x: 1348, y: 790, width: 450, height: 155 },
  sonatas: { x: 1450, y: 980, width: 450, height: 40 },
  footer: { x: 19, y: 1037, width: 1882, height: 30 }
}
const DEFAULT_STRAIGHT_SECTION_RECTS: Partial<Record<DebugSectionKey, DebugSectionRect>> = {
  ...DEFAULT_CURVED_SECTION_RECTS,
  art: { x: -954, y: -500, width: 3840, height: 2160 },
  identity: { x: 19, y: 15, width: 450, height: 178 },
  stats: { x: 19, y: 201, width: 450, height: 591 },
  weapon: { x: 19, y: 802, width: 450, height: 225 },
  sequences: { x: 620, y: 23, width: 680, height: 124 },
  skills: { x: 580, y: 673, width: 760, height: 352 },
  echoHeader: { x: 1450, y: 18, width: 450, height: 120 },
  echo0: { x: 1450, y: 150, width: 450, height: 155 },
  echo1: { x: 1450, y: 310, width: 450, height: 155 },
  echo2: { x: 1450, y: 470, width: 450, height: 155 },
  echo3: { x: 1450, y: 630, width: 450, height: 155 },
  echo4: { x: 1450, y: 790, width: 450, height: 155 },
  sonatas: { x: 1450, y: 980, width: 450, height: 40 },
  footer: { x: 19, y: 1037, width: 1882, height: 30 }
}
const LAYOUT_PRESET_DEBUG_SECTIONS: DebugSectionKey[] = ['identity', 'stats', 'weapon', 'echoHeader', ...ECHO_DEBUG_SECTIONS, 'sonatas']

const clampDebugRect = (rect: DebugSectionRect, section?: DebugSectionKey): DebugSectionRect => {
  const isArt = section === 'art'
  const canvasWidth = isArt ? ART_CANVAS_WIDTH : CARD_WIDTH
  const canvasHeight = isArt ? ART_CANVAS_HEIGHT : CARD_HEIGHT
  const minimumWidth = isArt ? CARD_WIDTH : 60
  const minimumHeight = isArt ? CARD_HEIGHT : 30
  const width = Math.max(minimumWidth, Math.min(canvasWidth, rect.width))
  const height = Math.max(minimumHeight, Math.min(canvasHeight, rect.height))
  const overscanX = isArt ? (ART_CANVAS_WIDTH - CARD_WIDTH) / 2 : 0
  const overscanY = isArt ? (ART_CANVAS_HEIGHT - CARD_HEIGHT) / 2 : 0
  return {
    x: Math.max(-overscanX, Math.min(CARD_WIDTH + overscanX - width, rect.x)),
    y: Math.max(-overscanY, Math.min(CARD_HEIGHT + overscanY - height, rect.y)),
    width,
    height
  }
}

interface SavedDebugLayout {
  layoutVersion: 1 | 2 | 3
  rects: Partial<Record<DebugSectionKey, DebugSectionRect>>
  hidden: DebugSectionKey[]
  echoLayout: EchoLayoutPreset | null
  accentColor: string | null
  colorEchoGrades: boolean
}

interface SavedDebugLayoutCollection {
  storageVersion: 2
  characters: Record<string, SavedDebugLayout>
}

const defaultDebugLayout = (): SavedDebugLayout => ({ layoutVersion: 3, rects: {}, hidden: [], echoLayout: 'curved', accentColor: null, colorEchoGrades: true })

const parseSavedDebugLayout = (value: unknown): SavedDebugLayout | null => {
  if (!value || typeof value !== 'object') return null
  const parsed = value as { layoutVersion?: number; rects?: Record<string, Partial<DebugSectionRect>>; hidden?: string[]; echoLayout?: string | null; accentColor?: string | null; colorEchoGrades?: boolean } & Record<string, unknown>
  const savedRects = parsed.rects ?? parsed
  const result: Partial<Record<DebugSectionKey, DebugSectionRect>> = {}
  DEBUG_SECTIONS.forEach(([key]) => {
    const rect = savedRects[key] as Partial<DebugSectionRect> | undefined
    if (rect && [rect.x, rect.y, rect.width, rect.height].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) result[key] = clampDebugRect(rect as DebugSectionRect, key)
  })
  const validKeys = new Set(DEBUG_SECTIONS.map(([key]) => key))
  const echoLayout = parsed.echoLayout === 'curved' || parsed.echoLayout === 'straight' ? parsed.echoLayout : Object.keys(result).length ? null : 'curved'
  const accentColor = typeof parsed.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.accentColor) ? parsed.accentColor : null
  return { layoutVersion: parsed.layoutVersion === 3 ? 3 : parsed.layoutVersion === 2 ? 2 : 1, rects: result, hidden: (parsed.hidden ?? []).filter((key): key is DebugSectionKey => validKeys.has(key as DebugSectionKey)), echoLayout, accentColor, colorEchoGrades: parsed.colorEchoGrades !== false }
}

const readDebugLayoutCollection = (): SavedDebugLayoutCollection | null => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEBUG_LAYOUT_STORAGE_KEY) ?? 'null') as Partial<SavedDebugLayoutCollection> | null
    if (parsed?.storageVersion !== 2 || !parsed.characters || typeof parsed.characters !== 'object') return null
    return { storageVersion: 2, characters: parsed.characters as Record<string, SavedDebugLayout> }
  } catch { return null }
}

const loadSavedDebugLayout = (characterId: string): SavedDebugLayout => {
  try {
    const raw = window.localStorage.getItem(DEBUG_LAYOUT_STORAGE_KEY)
    if (!raw) return defaultDebugLayout()
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && (parsed as Partial<SavedDebugLayoutCollection>).storageVersion === 2) {
      return parseSavedDebugLayout((parsed as SavedDebugLayoutCollection).characters?.[characterId]) ?? defaultDebugLayout()
    }
    const legacyLayout = parseSavedDebugLayout(parsed) ?? defaultDebugLayout()
    const migrated: SavedDebugLayoutCollection = { storageVersion: 2, characters: { [characterId]: legacyLayout } }
    window.localStorage.setItem(DEBUG_LAYOUT_STORAGE_KEY, JSON.stringify(migrated))
    return legacyLayout
  } catch { return defaultDebugLayout() }
}

const saveCharacterDebugLayout = (characterId: string, layout: SavedDebugLayout) => {
  const collection = readDebugLayoutCollection() ?? { storageVersion: 2 as const, characters: {} }
  window.localStorage.setItem(DEBUG_LAYOUT_STORAGE_KEY, JSON.stringify({ ...collection, characters: { ...collection.characters, [characterId]: layout } }))
}

const exportedLayout = (layout: SavedDebugLayout) => ({ format: 'tacet-lab-character-card-layout', version: 1, layout })

const parseImportedLayout = (value: unknown): SavedDebugLayout | null => {
  if (!value || typeof value !== 'object') return null
  const imported = value as { format?: unknown; version?: unknown; layout?: unknown }
  if (imported.format !== 'tacet-lab-character-card-layout' || imported.version !== 1) return null
  if (!imported.layout || typeof imported.layout !== 'object') return null
  const layout = imported.layout as Partial<SavedDebugLayout>
  if (layout.layoutVersion !== 3 || !layout.rects || typeof layout.rects !== 'object' || !Array.isArray(layout.hidden)) return null
  return parseSavedDebugLayout(imported.layout)
}

function DebugCoordinateInput({ section, property, rect, onChange }: { section: DebugSectionKey; property: keyof DebugSectionRect; rect: DebugSectionRect; onChange: (rect: DebugSectionRect) => void }) {
  const [draft, setDraft] = useState(String(Math.round(rect[property])))
  useEffect(() => setDraft(String(Math.round(rect[property]))), [section, property, rect, rect[property]])
  const minimum = section === 'art' && property === 'x' ? -(ART_CANVAS_WIDTH - CARD_WIDTH) / 2
    : section === 'art' && property === 'y' ? -(ART_CANVAS_HEIGHT - CARD_HEIGHT) / 2
      : property === 'width' ? (section === 'art' ? CARD_WIDTH : 60)
        : property === 'height' ? (section === 'art' ? CARD_HEIGHT : 30) : 0
  return <input type="number" min={minimum} step="1" value={draft} onChange={(event) => {
    const nextDraft = event.target.value
    setDraft(nextDraft)
    const value = Number(nextDraft)
    if (nextDraft.trim() && Number.isFinite(value)) onChange({ ...rect, [property]: value })
  }}/>
}

export type BuildCardStatKey = StatKey | 'tuneBreakBoost'

export interface BuildCardStatRow {
  key: BuildCardStatKey
  label: string
}

const PRIORITY_DISPLAY_KEYS: Partial<Record<StatKey, BuildCardStatKey>> = {
  hp: 'hp', hpPercent: 'hp', atk: 'atk', atkPercent: 'atk', def: 'def', defPercent: 'def',
  critRate: 'critRate', critDamage: 'critDamage', energyRegen: 'energyRegen',
  basicDamage: 'basicDamage', heavyDamage: 'heavyDamage', skillDamage: 'skillDamage', liberationDamage: 'liberationDamage',
  spectroDamage: 'spectroDamage', fusionDamage: 'fusionDamage', glacioDamage: 'glacioDamage', electroDamage: 'electroDamage', aeroDamage: 'aeroDamage', havocDamage: 'havocDamage'
}

const contributingStatKeys = (key: BuildCardStatKey): StatKey[] => key === 'hp' ? ['hp', 'hpPercent'] : key === 'atk' ? ['atk', 'atkPercent'] : key === 'def' ? ['def', 'defPercent'] : key === 'tuneBreakBoost' ? [] : [key]
const contributesToStat = (source: StatKey, target: BuildCardStatKey | null) => Boolean(target && contributingStatKeys(target).includes(source))
const displayedStatKey = (source: StatKey): BuildCardStatKey => source === 'hpPercent' ? 'hp' : source === 'atkPercent' ? 'atk' : source === 'defPercent' ? 'def' : source

const BUILD_SCORE_GRADES = [
  [75, 'SSS'], [65, 'SS'], [55, 'S'], [45, 'A'], [35, 'B'], [25, 'C'], [15, 'D'], [0, 'E']
] as const

export function prioritizedBuildCardStats(catalog: CharacterCatalogEntry, profile: CharacterSubstatProfile): BuildCardStatRow[] {
  const rows: BuildCardStatRow[] = [
    { key: 'hp', label: 'HP' },
    { key: 'atk', label: 'ATK' },
    { key: 'def', label: 'DEF' }
  ]
  const weights = new Map<BuildCardStatKey, number>()
  for (const [sourceKey, weight] of Object.entries(profile.weights) as Array<[StatKey, number]>) {
    const key = PRIORITY_DISPLAY_KEYS[sourceKey]
    if (!key || !weight) continue
    weights.set(key, Math.max(weights.get(key) ?? 0, weight))
  }
  const priorities = [...weights.entries()]
    .filter(([key]) => !rows.some((row) => row.key === key))
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .map(([key]) => ({ key, label: statLabels[key as StatKey] }))
  const elementKey = `${catalog.element.toLowerCase()}Damage` as StatKey
  const fallback = [
    { key: 'critRate', label: 'Crit. Rate' },
    { key: 'critDamage', label: 'Crit. DMG' },
    { key: 'energyRegen', label: 'Energy Regen' },
    { key: elementKey, label: `${catalog.element} DMG` }
  ] as BuildCardStatRow[]
  const ordered = [...rows, ...(priorities.length ? priorities : fallback), { key: elementKey, label: `${catalog.element} DMG` }]
  return ordered.filter((row, index) => ordered.findIndex((candidate) => candidate.key === row.key) === index)
}

function formatStat(key: StatKey, value: number) {
  return key === 'hp' || key === 'atk' || key === 'def'
    ? Math.floor(value + 1e-9).toLocaleString('en-US')
    : `${value.toFixed(1)}%`
}

function Stars({ rarity }: { rarity: number }) {
  return <span className="cbc-stars" aria-label={`${rarity} star rarity`}>{'★'.repeat(rarity)}</span>
}

function StatIcon({ stat }: { stat: BuildCardStatKey }) {
  const iconNames: Partial<Record<BuildCardStatKey, string>> = {
    hp: 'Icon_Attribute_Health.webp', atk: 'Icon_Attribute_Attack.webp', def: 'Icon_Attribute_Defense.webp',
    critRate: 'Icon_Attribute_Crit_Rate.webp', critDamage: 'Icon_Attribute_Crit_DMG.webp', energyRegen: 'Icon_Attribute_Energy_Regen.webp',
    healingBonus: 'Icon_Attribute_Healing.webp', basicDamage: 'Icon_Basic_Attack_DMG_Amplification.webp',
    heavyDamage: 'Icon_Heavy_Attack_DMG_Amplification.webp', skillDamage: 'Icon_Resonance_Skill_DMG_Amplification.webp',
    liberationDamage: 'Icon_Resonance_Liberation_DMG_Amplification.webp', glacioDamage: 'Icon_Glacio_DMG_Bonus.webp',
    fusionDamage: 'Icon_Fusion_DMG_Bonus.webp', electroDamage: 'Icon_Electro_DMG_Bonus.webp', aeroDamage: 'Icon_Aero_DMG_Bonus.webp',
    spectroDamage: 'Icon_Spectro_DMG_Bonus.webp', havocDamage: 'Icon_Havoc_DMG_Bonus.webp',
    tuneBreakBoost: 'Icon_Attribute_Tune_Break_Boost.webp'
  }
  return <img className="cbc-stat-icon" src={`https://wuwa-optimizer.com/images/icons/${iconNames[stat] ?? 'Icon_Attribute_Attack.webp'}`} alt="" aria-hidden="true"/>
}

function richDescription(description: string) {
  const nodes: ReactNode[] = []
  const colors: string[] = []
  const tokens = description.replace(/\{Cus:[^}]*\}/g, '').split(/(<[^>]+>)/g)
  tokens.forEach((token, index) => {
    const colorOpen = token.match(/^<color=([^>]+)>$/i)
    if (colorOpen) { colors.push(colorOpen[1].toLowerCase()); return }
    if (/^<\/color>$/i.test(token)) { colors.pop(); return }
    if (/^<[^>]+>$/.test(token) || !token) return
    const color = colors.at(-1)?.replace(/[^a-z0-9_-]/g, '')
    nodes.push(<span className={color ? `cbc-rich-${color}` : undefined} key={`${index}-${token.slice(0, 10)}`}>{token}</span>)
  })
  return nodes
}

function CardTooltip({ title, children }: { title: string; children: ReactNode }) {
  return <span className="cbc-tooltip" role="tooltip"><strong>{title}</strong><span>{children}</span></span>
}

export function echoRollBreakdown(stat: { key: StatKey; value: number }) {
  const rolls = tunableRolls[stat.key] ?? []
  const index = rolls.findIndex((roll) => Math.abs(roll.value - stat.value) < .001)
  const exact = index >= 0 ? rolls[index] : undefined
  return {
    index,
    tier: exact ? index + 1 : 0,
    tierCount: rolls.length,
    probability: exact?.probability,
    minimum: rolls[0]?.value,
    maximum: rolls.at(-1)?.value,
    valid: Boolean(exact)
  }
}

function RollBreakdown({ stat }: { stat: { key: StatKey; value: number } }) {
  const breakdown = echoRollBreakdown(stat)
  const rolls = tunableRolls[stat.key] ?? []
  return <span className={`cbc-roll-breakdown ${breakdown.valid ? '' : 'is-unknown'}`} aria-label={breakdown.valid ? `Roll ${breakdown.tier} of ${breakdown.tierCount}` : 'Unknown roll value'}>
    <span className="cbc-roll-track">{rolls.map((roll, rollIndex) => <i className={breakdown.valid && rollIndex <= breakdown.index ? 'is-filled' : ''} key={roll.value}/>)}</span>
    <CardTooltip title={statLabels[stat.key]}>{breakdown.valid ? <>Roll {breakdown.tier}/{breakdown.tierCount} · {breakdown.probability!.toFixed(2)}% chance · range {formatStat(stat.key, breakdown.minimum!)}–{formatStat(stat.key, breakdown.maximum!)}</> : <>This value does not exactly match a bundled legal roll.</>}</CardTooltip>
  </span>
}

function echoRollGradeClass(stat: { key: StatKey; value: number }) {
  const breakdown = echoRollBreakdown(stat)
  if (!breakdown.valid || breakdown.tierCount < 2) return 'roll-color-unknown'
  const quality = breakdown.tier / breakdown.tierCount
  return quality === 1 ? 'roll-color-red' : quality >= .75 ? 'roll-color-gold' : quality >= .5 ? 'roll-color-purple' : quality >= .375 ? 'roll-color-blue' : quality >= .25 ? 'roll-color-green' : 'roll-color-white'
}

function EchoRow({ echo, index, profile, editable, onOpen, onEdit, debugSection, debugClassName, debugStyle, highlightedStat, setHighlightedStat, colorGrades }: { echo?: Echo; index: number; profile: CharacterSubstatProfile; editable: boolean; onOpen: () => void; onEdit: (echo: Echo) => void; debugSection: DebugSectionKey; debugClassName: string; debugStyle?: CSSProperties; highlightedStat: BuildCardStatKey | null; setHighlightedStat: (stat: BuildCardStatKey | null) => void; colorGrades: boolean }) {
  const [actionsOpen, setActionsOpen] = useState(false)
  if (!echo) return <button type="button" className={`cbc-echo-row cbc-echo-slot-${index} is-empty ${editable ? 'is-editable' : ''} ${debugClassName}`} data-debug-section={debugSection} style={debugStyle} disabled={!editable} onClick={editable ? onOpen : undefined}>
    <span>+</span><strong>Empty Echo slot</strong><small>{index === 0 ? 'Main Echo' : `Echo ${index + 1}`}</small>
  </button>
  const catalog = echoCatalogByName.get(echo.name)
  const secondary = fixedSecondaryMainStat(echo)
  const substats = effectiveSubStats(echo)
  const score = scoreCharacterSubstats(echo, profile)
  const sonataIconSourceUrl = generatedSonataIconSources[echo.sonata]
  const scoreText = score.valid && score.grade ? `${score.grade} · ${score.percentage.toFixed(1)}%${score.provisional ? '*' : ''}` : profile.maximum > 0 ? 'Unverified' : 'Unconfigured'
  const scoreGradeClass = score.valid && score.grade ? `cbc-score-grade-${score.grade.toLowerCase()}` : ''
  return <article className={`cbc-echo-row cbc-echo-slot-${index} ${index === 0 ? 'is-main' : ''} ${editable ? 'is-editable' : ''} ${colorGrades ? 'is-grade-colored' : ''} ${debugClassName}`} data-debug-section={debugSection} style={debugStyle} role={editable ? 'button' : undefined} aria-label={editable ? `Edit ${echo.name}` : `${echo.name} Echo`} tabIndex={0} onClick={editable ? () => setActionsOpen((open) => !open) : undefined} onKeyDown={editable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActionsOpen((open) => !open) } } : undefined}>
    <div className="cbc-echo-visual">
      <span className="cbc-echo-art">{catalog?.iconSourceUrl ? <img src={catalog.iconSourceUrl} alt=""/> : <b>◆</b>}</span>
      {sonataIconSourceUrl && <img className="cbc-echo-sonata-icon" src={sonataIconSourceUrl} alt="" title={echo.sonata}/>} 
      <i className="cbc-echo-cost">{echo.cost}</i>
    </div>
    <div className="cbc-echo-main-stats">
      {[echo.mainStat, secondary].map((stat, statIndex) => <span className={`cbc-stat-source ${contributesToStat(stat.key, highlightedStat) ? 'is-contributing' : ''}`} tabIndex={0} onMouseEnter={() => setHighlightedStat(displayedStatKey(stat.key))} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => setHighlightedStat(displayedStatKey(stat.key))} onBlur={() => setHighlightedStat(null)} key={`${stat.key}-${statIndex}`}><small>{statLabels[stat.key]}</small><b>{formatStat(stat.key, stat.value)}</b></span>)}
    </div>
    <div className="cbc-echo-substats">{substats.map((stat, statIndex) => <span className={`cbc-stat-source ${contributesToStat(stat.key, highlightedStat) ? 'is-contributing' : ''}`} tabIndex={0} onMouseEnter={() => setHighlightedStat(displayedStatKey(stat.key))} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => setHighlightedStat(displayedStatKey(stat.key))} onBlur={() => setHighlightedStat(null)} key={`${stat.key}-${statIndex}`}><small>{statLabels[stat.key]}</small><b className={colorGrades ? echoRollGradeClass(stat) : ''}>{formatStat(stat.key, stat.value)}</b><RollBreakdown stat={stat}/></span>)}</div>
    <div className="cbc-echo-score"><small>Substat score</small><strong className={scoreGradeClass}>{scoreText}</strong></div>
    {actionsOpen && editable && <div className="cbc-edit-popover cbc-echo-actions" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => { setActionsOpen(false); onEdit(echo) }}><Icon name="edit"/>Edit Echo</button><button type="button" onClick={() => { setActionsOpen(false); onOpen() }}>↔ Switch Echo</button></div>}
  </article>
}

interface CharacterBuildCardProps {
  character: OwnedCharacter
  catalog: CharacterCatalogEntry
  model: CharacterShowcaseModel
  settings: AppSettings
  profile: CharacterSubstatProfile
  statRows: BuildCardStatRow[]
  statDetail: (key: BuildCardStatKey, label: string) => CalculationDetail
  editable: boolean
  portraitRef: RefObject<HTMLImageElement | null>
  livePortraitRef: RefObject<NanokaSpinePortraitHandle | null>
  portraitFailed: boolean
  animatedPortraitReady: boolean
  enabledSkillTreeNodeIds: string[]
  onPortraitError: () => void
  onLiveReady: () => void
  onLiveFallback: () => void
  onSetLevel: (level: number) => void
  onSetSequence: (sequence: number) => void
  onSetSkillLevel: (index: number, level: number) => void
  onToggleSkillTreeNode: (id: string) => void
  onOpenWeapon: () => void
  onOpenEcho: (index: number) => void
  onEditEcho: (echo: Echo) => void
  onEditPriorities: () => void
  onShowScoreInfo: () => void
  onAccentChange?: (color: string | null) => void
  layoutControlsHost?: HTMLElement | null
  layoutPanelHost?: HTMLElement | null
}

export const CharacterBuildCard = forwardRef<HTMLDivElement, CharacterBuildCardProps>(function CharacterBuildCard(props, forwardedRef) {
  const {
    character, catalog, model, settings, profile, statRows, statDetail, editable,
    portraitRef, livePortraitRef, portraitFailed, animatedPortraitReady, enabledSkillTreeNodeIds,
    onPortraitError, onLiveReady, onLiveFallback, onSetLevel, onSetSequence, onSetSkillLevel,
    onToggleSkillTreeNode, onOpenWeapon, onOpenEcho, onEditEcho, onEditPriorities, onShowScoreInfo, onAccentChange, layoutControlsHost, layoutPanelHost
  } = props
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [levelOpen, setLevelOpen] = useState(false)
  const [skillLevelOpen, setSkillLevelOpen] = useState<number | null>(null)
  const savedDebugLayoutRef = useRef<SavedDebugLayout | null>(null)
  if (!savedDebugLayoutRef.current) savedDebugLayoutRef.current = loadSavedDebugLayout(catalog.id)
  const [hiddenDebugSections, setHiddenDebugSections] = useState<Set<DebugSectionKey>>(() => new Set(savedDebugLayoutRef.current?.hidden ?? []))
  const [echoLayoutPreset, setEchoLayoutPreset] = useState<EchoLayoutPreset | null>(() => savedDebugLayoutRef.current?.echoLayout ?? 'curved')
  const elementAccent = ELEMENT_ACCENTS[catalog.element] ?? '#e4bb5e'
  const [customAccent, setCustomAccent] = useState<string | null>(() => savedDebugLayoutRef.current?.accentColor ?? null)
  const [colorEchoGrades, setColorEchoGrades] = useState(() => savedDebugLayoutRef.current?.colorEchoGrades ?? true)
  const [highlightedStat, setHighlightedStat] = useState<BuildCardStatKey | null>(null)
  const [debugCalibrationEnabled, setDebugCalibrationEnabled] = useState(false)
  const [selectedDebugSection, setSelectedDebugSection] = useState<DebugSectionKey>('identity')
  const [debugSectionRects, setDebugSectionRects] = useState<Partial<Record<DebugSectionKey, DebugSectionRect>>>({})
  const debugSectionOriginRectsRef = useRef<Partial<Record<DebugSectionKey, DebugSectionRect>>>({})
  const defaultDebugSectionRectsRef = useRef<Partial<Record<DebugSectionKey, DebugSectionRect>>>({})
  const debugLayoutSnapshotRef = useRef<SavedDebugLayout | null>(null)
  const layoutImportRef = useRef<HTMLInputElement>(null)
  const [layoutTransferStatus, setLayoutTransferStatus] = useState<string | null>(null)
  const accentStyle = { '--cbc-accent': customAccent ?? elementAccent } as CSSProperties
  const debugSectionClass = (section: DebugSectionKey, className: string) => `${className} cbc-debug-section${hiddenDebugSections.has(section) ? ' is-debug-hidden' : ''}`
  const debugSectionStyle = (section: DebugSectionKey): CSSProperties | undefined => {
    const rect = debugSectionRects[section], initial = debugSectionOriginRectsRef.current[section]
    if (!rect || !initial) return undefined
    return {
      '--cbc-debug-x': `${rect.x - initial.x}px`, '--cbc-debug-y': `${rect.y - initial.y}px`,
      width: rect.width, height: rect.height
    } as CSSProperties
  }
  const toggleDebugSection = (section: DebugSectionKey) => setHiddenDebugSections((current) => {
    const next = new Set(current)
    if (next.has(section)) next.delete(section)
    else next.add(section)
    return next
  })

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const resize = () => setScale(Math.min(1, viewport.clientWidth / CARD_WIDTH))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => onAccentChange?.(customAccent), [customAccent, onAccentChange])

  useEffect(() => {
    const saved = loadSavedDebugLayout(catalog.id)
    savedDebugLayoutRef.current = saved
    debugLayoutSnapshotRef.current = null
    setDebugCalibrationEnabled(false)
    setHiddenDebugSections(new Set(saved.hidden))
    setEchoLayoutPreset(saved.echoLayout)
    setCustomAccent(saved.accentColor)
    setColorEchoGrades(saved.colorEchoGrades)
    setLayoutTransferStatus(null)
  }, [catalog.id])

  useEffect(() => {
    debugSectionOriginRectsRef.current = {}
    defaultDebugSectionRectsRef.current = {}
    setDebugSectionRects({})
    let measureFrame = 0
    const resetFrame = requestAnimationFrame(() => {
      measureFrame = requestAnimationFrame(() => {
        const card = viewportRef.current?.querySelector<HTMLElement>('.cbc-card')
        if (!card) return
        const cardBounds = card.getBoundingClientRect()
        const scaleX = CARD_WIDTH / cardBounds.width, scaleY = CARD_HEIGHT / cardBounds.height
        const measured: Partial<Record<DebugSectionKey, DebugSectionRect>> = {}
        DEBUG_SECTIONS.forEach(([key]) => {
          const element = card.querySelector<HTMLElement>(`[data-debug-section="${key}"]`)
          if (!element) return
          const bounds = element.getBoundingClientRect()
          measured[key] = {
            x: (bounds.left - cardBounds.left) * scaleX,
            y: (bounds.top - cardBounds.top) * scaleY,
            width: bounds.width * scaleX,
            height: bounds.height * scaleY
          }
        })
        const defaults = { ...measured, ...DEFAULT_CURVED_SECTION_RECTS }
        debugSectionOriginRectsRef.current = measured
        defaultDebugSectionRectsRef.current = defaults
        const restored = { ...defaults, ...(savedDebugLayoutRef.current?.rects ?? {}) }
        const savedPreset = savedDebugLayoutRef.current?.echoLayout
        const defaultSonata = DEFAULT_CURVED_SECTION_RECTS.sonatas
        if ((savedDebugLayoutRef.current?.layoutVersion ?? 1) < 3 && restored.sonatas && defaultSonata) restored.sonatas = { ...restored.sonatas, width: defaultSonata.width, height: defaultSonata.height }
        if (savedPreset) LAYOUT_PRESET_DEBUG_SECTIONS.forEach((section) => {
          const presetRect = (savedPreset === 'curved' ? DEFAULT_CURVED_SECTION_RECTS : DEFAULT_STRAIGHT_SECTION_RECTS)[section]
          if (presetRect) restored[section] = { ...presetRect }
        })
        setDebugSectionRects(restored)
      })
    })
    return () => { cancelAnimationFrame(resetFrame); cancelAnimationFrame(measureFrame) }
  }, [catalog.id])

  const updateDebugSectionRect = (section: DebugSectionKey, rect: DebugSectionRect) => {
    if (LAYOUT_PRESET_DEBUG_SECTIONS.includes(section)) setEchoLayoutPreset(null)
    setDebugSectionRects((current) => ({ ...current, [section]: clampDebugRect(rect, section) }))
  }
  const applyEchoLayoutPreset = (preset: EchoLayoutPreset) => {
    const presetRects = preset === 'curved' ? DEFAULT_CURVED_SECTION_RECTS : DEFAULT_STRAIGHT_SECTION_RECTS
    setDebugSectionRects((current) => {
      const next = { ...current }
      LAYOUT_PRESET_DEBUG_SECTIONS.forEach((section) => {
        const presetRect = presetRects[section]
        if (presetRect) next[section] = { ...presetRect }
      })
      return next
    })
    setEchoLayoutPreset(preset)
  }
  const beginDebugSectionDrag = (event: React.PointerEvent, section: DebugSectionKey, mode: 'move' | 'resize') => {
    const card = viewportRef.current?.querySelector<HTMLElement>('.cbc-card'), initial = debugSectionRects[section]
    if (!card || !initial) return
    const bounds = card.getBoundingClientRect(), scaleX = CARD_WIDTH / bounds.width, scaleY = CARD_HEIGHT / bounds.height
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedDebugSection(section)
    const startX = event.clientX, startY = event.clientY
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) * scaleX, dy = (next.clientY - startY) * scaleY
      updateDebugSectionRect(section, mode === 'move' ? { ...initial, x: initial.x + dx, y: initial.y + dy } : { ...initial, width: initial.width + dx, height: initial.height + dy })
    }
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true })
  }
  const resetDebugSection = (section: DebugSectionKey) => {
    const initial = defaultDebugSectionRectsRef.current[section]
    if (initial) {
      if (LAYOUT_PRESET_DEBUG_SECTIONS.includes(section)) setEchoLayoutPreset(null)
      setDebugSectionRects((current) => ({ ...current, [section]: { ...initial } }))
    }
  }
  const resetAllDebugSections = () => {
    setDebugSectionRects(Object.fromEntries(Object.entries(defaultDebugSectionRectsRef.current).map(([key, rect]) => [key, { ...rect }])) as Partial<Record<DebugSectionKey, DebugSectionRect>>)
    setEchoLayoutPreset('curved')
    setCustomAccent(null)
    setColorEchoGrades(true)
  }
  const beginDebugPositioning = () => {
    debugLayoutSnapshotRef.current = {
      layoutVersion: 3,
      rects: Object.fromEntries(Object.entries(debugSectionRects).map(([key, rect]) => [key, { ...rect }])) as Partial<Record<DebugSectionKey, DebugSectionRect>>,
      hidden: [...hiddenDebugSections],
      echoLayout: echoLayoutPreset,
      accentColor: customAccent,
      colorEchoGrades
    }
    setDebugCalibrationEnabled(true)
  }
  const cancelDebugPositioning = () => {
    const snapshot = debugLayoutSnapshotRef.current
    if (snapshot) {
      setDebugSectionRects(Object.fromEntries(Object.entries(snapshot.rects).map(([key, rect]) => [key, { ...rect }])) as Partial<Record<DebugSectionKey, DebugSectionRect>>)
      setHiddenDebugSections(new Set(snapshot.hidden))
      setEchoLayoutPreset(snapshot.echoLayout)
      setCustomAccent(snapshot.accentColor)
      setColorEchoGrades(snapshot.colorEchoGrades)
    }
    setDebugCalibrationEnabled(false)
  }
  const saveDebugPositioning = () => {
    const saved = { layoutVersion: 3 as const, rects: debugSectionRects, hidden: [...hiddenDebugSections], echoLayout: echoLayoutPreset, accentColor: customAccent, colorEchoGrades }
    try { saveCharacterDebugLayout(catalog.id, saved) } catch { /* Keep the calibrated layout in memory when browser storage is unavailable. */ }
    savedDebugLayoutRef.current = saved
    debugLayoutSnapshotRef.current = null
    setDebugCalibrationEnabled(false)
  }
  const currentDebugLayout = (): SavedDebugLayout => ({ layoutVersion: 3, rects: debugSectionRects, hidden: [...hiddenDebugSections], echoLayout: echoLayoutPreset, accentColor: customAccent, colorEchoGrades })
  const exportDebugLayout = () => {
    const blob = new Blob([JSON.stringify(exportedLayout(currentDebugLayout()), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${catalog.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character'}-card-layout.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setLayoutTransferStatus('Layout exported.')
  }
  const importDebugLayout = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = parseImportedLayout(JSON.parse(await file.text()))
      if (!imported) throw new Error('Unsupported layout file')
      setDebugSectionRects({ ...defaultDebugSectionRectsRef.current, ...imported.rects })
      setHiddenDebugSections(new Set(imported.hidden))
      setEchoLayoutPreset(imported.echoLayout)
      setCustomAccent(imported.accentColor)
      setColorEchoGrades(imported.colorEchoGrades)
      setLayoutTransferStatus('Layout imported. Save changes to keep it for this character.')
    } catch {
      setLayoutTransferStatus('That file is not a valid Tacet Lab card layout.')
    }
  }
  const artRect = debugSectionRects.art
  const maximumArtZoom = Math.floor(Math.min(ART_CANVAS_WIDTH / CARD_WIDTH, ART_CANVAS_HEIGHT / CARD_HEIGHT) * 100)
  const artZoom = artRect ? Math.round(artRect.width / CARD_WIDTH * 100) : 200
  const updateArtZoom = (zoom: number) => {
    if (!artRect) return
    const scale = zoom / 100
    const width = CARD_WIDTH * scale
    const height = CARD_HEIGHT * scale
    updateDebugSectionRect('art', {
      x: artRect.x - (width - artRect.width) / 2,
      y: artRect.y - (height - artRect.height) / 2,
      width,
      height
    })
  }

  const sonataDetails = useMemo(() => model.sonatas.map((active) => ({
    ...active,
    effects: sonataCatalog.find((entry) => entry.name === active.name)?.effects.filter((effect) => active.count >= effect.pieces) ?? []
  })), [model.sonatas])

  const buildScore = useMemo(() => {
    const scores = model.equippedEchoes.map((echo) => scoreCharacterSubstats(echo, profile))
    if (profile.maximum <= 0) return { label: 'Unconfigured', percentage: 0, grade: undefined as string | undefined }
    if (!scores.length) return { label: 'No Echoes', percentage: 0, grade: undefined as string | undefined }
    if (scores.some((score) => !score.valid)) return { label: 'Unverified', percentage: 0, grade: undefined as string | undefined }
    const percentage = Math.min(100, scores.reduce((total, score) => total + score.points, 0) / (profile.maximum * 5) * 100)
    return {
      label: `${percentage.toFixed(1)}%${scores.length < 5 || scores.some((score) => score.provisional) ? '*' : ''}`,
      percentage,
      grade: BUILD_SCORE_GRADES.find(([minimum]) => percentage >= minimum)?.[1]
    }
  }, [model.equippedEchoes, profile])
  const bonusSourceContributes = (idPrefix: string) => Boolean(highlightedStat && model.statBonusSources.some((source) => source.id.startsWith(idPrefix) && source.lines.some((line) => contributesToStat(line.key, highlightedStat))))
  const bonusSourceStat = (idPrefix: string) => model.statBonusSources.find((source) => source.id.startsWith(idPrefix))?.lines[0]?.key
  const weaponContributes = highlightedStat === 'atk' || Boolean(model.weapon?.secondaryStat && contributesToStat(model.weapon.secondaryStat.key, highlightedStat)) || bonusSourceContributes('weapon-')
  const highlightedSkillNode = Boolean(highlightedStat && SKILLS.some(([key], index) => {
    const regular = catalog.skillTreeExtras.bonusStatBranches[key].map((bonus, sourceIndex) => ({ bonus, id: skillTreeBonusId(key, sourceIndex) }))
    const nodes = index === 2 ? [...regular, ...catalog.skillTreeExtras.inherentSkills.map((bonus, sourceIndex) => ({ bonus, id: inherentSkillBonusId(sourceIndex) }))] : regular
    return nodes.some(({ bonus, id }) => enabledSkillTreeNodeIds.includes(id) && Boolean(skillTreeStatLine(bonus.name, bonus.description)?.key && contributesToStat(skillTreeStatLine(bonus.name, bonus.description)!.key, highlightedStat)))
  }))

  return <div className="cbc-card-layout" style={accentStyle}>
    <div className="cbc-viewport" ref={viewportRef} style={{ height: CARD_HEIGHT * scale }}>
    <div ref={forwardedRef} className={`cs-export-frame cbc-card cbc-debug-enabled${highlightedStat ? ' is-stat-highlighting' : ''}`} style={{ ...accentStyle, transform: `scale(${scale})` }}>
      <section className="cbc-art-stage" aria-label={`${catalog.name} character artwork`}>
        <div className={debugSectionClass('art', 'cbc-art-positioner')} data-debug-section="art" style={debugSectionStyle('art')}>
          <img ref={portraitRef} className={`cbc-character-art ${portraitFailed ? 'is-fallback' : ''} ${animatedPortraitReady ? 'is-live-hidden' : ''}`} src={portraitFailed ? catalog.iconSourceUrl : (catalog.portraitSourceUrl || catalog.iconSourceUrl)} alt={catalog.name} onError={onPortraitError}/>
          <img className="cbc-live-portrait-snapshot" alt="" aria-hidden="true"/>
          {catalog.spineSkeletonSourceUrl && catalog.spineAtlasSourceUrl && <NanokaSpinePortrait ref={livePortraitRef} skeletonSourceUrl={catalog.spineSkeletonSourceUrl} atlasSourceUrl={catalog.spineAtlasSourceUrl} renderScale={scale} onReady={onLiveReady} onFallback={onLiveFallback}/>}
        </div>
      </section>

      <section className={debugSectionClass('sequences', 'cbc-sequences')} data-debug-section="sequences" style={debugSectionStyle('sequences')} aria-label={`Sequence ${character.sequence}`}>{catalog.sequenceIcons.slice(0, 6).map((sequence) => { const sourceStat = bonusSourceStat(`sequence-${sequence.sequence}`); return <button type="button" key={sequence.sequence} aria-disabled={!editable} className={`${character.sequence >= sequence.sequence ? 'is-unlocked' : 'is-locked'} cbc-stat-source${bonusSourceContributes(`sequence-${sequence.sequence}`) ? ' is-contributing' : ''}`} onMouseEnter={() => sourceStat && setHighlightedStat(displayedStatKey(sourceStat))} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => sourceStat && setHighlightedStat(displayedStatKey(sourceStat))} onBlur={() => setHighlightedStat(null)} onClick={() => { if (editable) onSetSequence(character.sequence === sequence.sequence ? sequence.sequence - 1 : sequence.sequence) }}>
        <span className="cbc-sequence-frame">
          <svg className="cbc-sequence-star" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M50 0C50 27 73 50 100 50C73 50 50 73 50 100C50 73 27 50 0 50C27 50 50 27 50 0Z"/>
          </svg>
          <img className="cbc-sequence-icon" src={sequence.iconSourceUrl} alt=""/>
        </span><CardTooltip title={`S${sequence.sequence} · ${sequence.name}`}>{richDescription(sequence.description)}</CardTooltip>
      </button>})}</section>

      <section className={`${debugSectionClass('skills', 'cbc-skills')}${highlightedSkillNode ? ' is-stat-node-active' : ''}`} data-debug-section="skills" style={debugSectionStyle('skills')} aria-label="Skills">
        <div className="cbc-skill-columns">{SKILLS.map(([key, label], index) => {
          const skill = catalog.skillIcons[key]
          const regularBonuses = catalog.skillTreeExtras.bonusStatBranches[key].map((bonus, sourceIndex) => ({ bonus, id: skillTreeBonusId(key, sourceIndex) }))
          const bonuses = index === 2 ? [...regularBonuses, ...catalog.skillTreeExtras.inherentSkills.map((bonus, sourceIndex) => ({ bonus, id: inherentSkillBonusId(sourceIndex) }))] : regularBonuses
          return <div className="cbc-skill-column" key={key}>
            <div className="cbc-skill-bonuses">
              <div className="cbc-skill-bonus-nodes">{bonuses.map(({ bonus, id }) => { const nodeStat = skillTreeStatLine(bonus.name, bonus.description); const contributes = enabledSkillTreeNodeIds.includes(id) && Boolean(nodeStat && contributesToStat(nodeStat.key, highlightedStat)); return <button type="button" aria-label={bonus.name} aria-disabled={!editable} className={`${enabledSkillTreeNodeIds.includes(id) ? 'is-enabled' : 'is-disabled'} cbc-stat-source${contributes ? ' is-contributing' : ''}`} onMouseEnter={() => nodeStat && setHighlightedStat(displayedStatKey(nodeStat.key))} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => nodeStat && setHighlightedStat(displayedStatKey(nodeStat.key))} onBlur={() => setHighlightedStat(null)} onClick={() => { if (editable) onToggleSkillTreeNode(id) }} key={id}><span><img src={bonus.iconSourceUrl} alt=""/></span></button> })}</div>
            </div>
            <button type="button" className="cbc-main-skill" aria-label={`${skill.name}, level ${model.skillLevels[index]}`} aria-disabled={!editable} onClick={() => { if (editable) setSkillLevelOpen(skillLevelOpen === index ? null : index) }}><span><img src={skill.iconSourceUrl} alt=""/></span><small>Lv. {model.skillLevels[index]}</small></button>
            {skillLevelOpen === index && editable && <div className="cbc-edit-popover cbc-skill-level-popover"><strong className="cbc-skill-level-title">{label}</strong><div><button type="button" disabled={model.skillLevels[index] <= 1} onClick={() => onSetSkillLevel(index, model.skillLevels[index] - 1)}>−</button><strong>Lv. {model.skillLevels[index]}</strong><button type="button" disabled={model.skillLevels[index] >= 10} onClick={() => onSetSkillLevel(index, model.skillLevels[index] + 1)}>+</button></div></div>}
          </div>
        })}</div>
        <div className="cbc-extra-skills">{[catalog.skillTreeExtras.outroSkill, catalog.skillTreeExtras.tuneBreakSkill].map((skill, index) => skill?.iconSourceUrl && <button type="button" aria-label={skill.name} key={`${skill.name}-${index}`}><span><img src={skill.iconSourceUrl} alt=""/></span></button>)}</div>
      </section>

      <div className="cbc-left-column">
        <section className={`${debugSectionClass('identity', 'cbc-identity cbc-glass')}${editable ? ' is-editable' : ''}`} data-debug-section="identity" style={debugSectionStyle('identity')} role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined} onClick={editable ? () => setLevelOpen((open) => !open) : undefined} onKeyDown={editable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setLevelOpen((open) => !open) } } : undefined}>
          <div><h1 style={{ fontSize: `${Math.max(23, 38 - Math.max(0, catalog.name.length - 10) * 1.15)}px` }}>{catalog.name}</h1><div className="cbc-identity-owner"><span>{settings.displayName.trim() || 'Resonator'}</span><small>{settings.uid.trim() ? `${settings.uid.trim()}` : ''}</small></div></div>
          <p>{catalog.title}</p>
          <button type="button" className={editable ? 'is-editable' : ''} disabled={!editable} onClick={(event) => { event.stopPropagation(); setLevelOpen((open) => !open) }}><strong>Lv. {character.level}</strong><Stars rarity={catalog.rarity}/></button>
          <div className="cbc-identity-tags"><span>{catalog.element}</span><span>{catalog.weaponType}</span><span>{catalog.role}</span></div>
          {levelOpen && editable && <div className="cbc-edit-popover cbc-level-popover" onClick={(event) => event.stopPropagation()}>{LEVELS.map((level) => <button type="button" className={level === character.level ? 'active' : ''} onClick={() => { onSetLevel(level); setLevelOpen(false) }} key={level}>{level}</button>)}</div>}
        </section>

        <section className={`${debugSectionClass('stats', 'cbc-stats cbc-glass')}${editable ? ' is-editable' : ''}`} data-debug-section="stats" style={debugSectionStyle('stats')} role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined} onClick={editable ? onEditPriorities : undefined} onKeyDown={editable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEditPriorities() } } : undefined}>
          <header><div><span>Resonator statistics</span><strong>Current attributes</strong></div><div className="cbc-stat-actions"><button type="button" title={editable ? 'Edit character stat priorities' : 'Stat priorities are read-only for this loadout'} disabled={!editable} onClick={(event) => { event.stopPropagation(); if (editable) onEditPriorities() }}><Icon name="settings"/></button></div></header>
          <div>{statRows.map(({ key, label }) => {
            const detail = statDetail(key, label)
            const value = key === 'tuneBreakBoost' ? Number(detail.value) : model.finalStats[key as keyof typeof model.finalStats] ?? 0
            return <div className={`cbc-stat-row${highlightedStat === key ? ' is-active' : ''}`} key={key} tabIndex={0} onMouseEnter={() => setHighlightedStat(key)} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => setHighlightedStat(key)} onBlur={() => setHighlightedStat(null)}><StatIcon stat={key}/><span>{label}</span><b>{key === 'tuneBreakBoost' ? Number(value).toFixed(1) : formatStat(key as StatKey, Number(value))}</b></div>
          })}</div>
        </section>

        <section className={`${debugSectionClass('weapon', `cbc-weapon cbc-glass ${editable ? 'is-editable' : ''}`)}${weaponContributes ? ' is-contributing-source-panel' : ''}`} data-debug-section="weapon" style={debugSectionStyle('weapon')} tabIndex={editable ? 0 : undefined} onClick={editable ? onOpenWeapon : undefined} onKeyDown={editable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenWeapon() } } : undefined}>
          {model.weapon ? <>
            <img src={model.weapon.catalog.iconSourceUrl} alt=""/>
            <div><small>Equipped weapon</small><h2>{model.weapon.catalog.name}</h2><Stars rarity={model.weapon.catalog.rarity}/><span>Lv. {model.weapon.owned.level} · R{model.weapon.owned.rank}</span><dl><div className={`cbc-stat-source${highlightedStat === 'atk' ? ' is-contributing' : ''}`} tabIndex={0} onMouseEnter={() => setHighlightedStat('atk')} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => setHighlightedStat('atk')} onBlur={() => setHighlightedStat(null)}><dt>Base ATK</dt><dd>{model.weapon.levelStats.baseAtk}</dd></div><div className={`cbc-stat-source${model.weapon.secondaryStat && contributesToStat(model.weapon.secondaryStat.key, highlightedStat) ? ' is-contributing' : ''}`} tabIndex={0} onMouseEnter={() => model.weapon?.secondaryStat && setHighlightedStat(displayedStatKey(model.weapon.secondaryStat.key))} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => model.weapon?.secondaryStat && setHighlightedStat(displayedStatKey(model.weapon.secondaryStat.key))} onBlur={() => setHighlightedStat(null)}><dt>{model.weapon.catalog.secondaryStat}</dt><dd>{model.weapon.levelStats.secondaryStatValue}</dd></div></dl></div>
            <CardTooltip title={model.weapon.catalog.passiveName || model.weapon.catalog.name}>{model.weapon.catalog.passiveEffects[Math.max(0, model.weapon.owned.rank - 1)] || model.weapon.catalog.description}</CardTooltip>
          </> : <button type="button" disabled={!editable}><span>+</span><strong>No weapon equipped</strong><small>{catalog.weaponType}</small></button>}
        </section>
      </div>

      <div className="cbc-center-column"/>

      <div className="cbc-right-column">
        <header className={debugSectionClass('echoHeader', 'cbc-build-score cbc-glass')} data-debug-section="echoHeader" style={debugSectionStyle('echoHeader')}><span>Build score</span><div><strong>{buildScore.grade ?? '—'}</strong><b>{buildScore.label}</b><button type="button" className="cbc-build-score-info" aria-label="How Substat Score works" title="How Substat Score works" onClick={onShowScoreInfo}>?</button></div></header>
        <section className="cbc-echo-stage">{model.echoSlots.map((echo, index) => {
          const debugSection = `echo${index}` as DebugSectionKey
          return <EchoRow echo={echo} index={index} profile={profile} editable={editable} onOpen={() => onOpenEcho(index)} onEdit={onEditEcho} debugSection={debugSection} debugClassName={debugSectionClass(debugSection, '')} debugStyle={debugSectionStyle(debugSection)} highlightedStat={highlightedStat} setHighlightedStat={setHighlightedStat} colorGrades={colorEchoGrades} key={echo?.id ?? `empty-${index}`}/>
        })}</section>
        <section className="cbc-sonatas"><div className={debugSectionClass('sonatas', 'cbc-sonata-content')} data-debug-section="sonatas" style={debugSectionStyle('sonatas')}>{sonataDetails.length ? sonataDetails.map((sonata) => { const source = model.statBonusSources.find((entry) => entry.id.startsWith('sonata-') && entry.label.startsWith(`${sonata.name} `)); const sourceStat = source?.lines[0]?.key; return <button type="button" className={`cbc-stat-source${highlightedStat && source?.lines.some((line) => contributesToStat(line.key, highlightedStat)) ? ' is-contributing' : ''}`} onMouseEnter={() => sourceStat && setHighlightedStat(displayedStatKey(sourceStat))} onMouseLeave={() => setHighlightedStat(null)} onFocus={() => sourceStat && setHighlightedStat(displayedStatKey(sourceStat))} onBlur={() => setHighlightedStat(null)} key={sonata.name}><img src={sonata.iconSourceUrl || generatedSonataIconSources[sonata.name]} alt=""/><strong>{sonata.name}</strong><small>{sonata.count}</small><CardTooltip title={sonata.name}>{sonata.effects.length ? sonata.effects.map((effect) => <span key={effect.pieces}><b>{effect.pieces}-piece</b> {richDescription(effect.description)}</span>) : <>No active set threshold.</>}</CardTooltip></button> }) : <em>No active Sonata</em>}</div></section>
      </div>

      <footer className={debugSectionClass('footer', 'cbc-footer')} data-debug-section="footer" style={debugSectionStyle('footer')}><span>TACET LAB</span><strong>The Ultimate One for All Site</strong></footer>
      {debugCalibrationEnabled && <div className="cbc-layout-calibration-layer" aria-label="Card section calibration">
        {DEBUG_SECTIONS.map(([key, label]) => {
          const rect = debugSectionRects[key]
          if (!rect) return null
          return <div role="button" tabIndex={0} aria-label={`Position ${label}`} title={`${label}: drag to move; use the corner to resize`} data-layout-section={key} className={`cbc-layout-calibration-box ${selectedDebugSection === key ? 'is-selected' : ''} ${hiddenDebugSections.has(key) ? 'is-hidden' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onPointerDown={(event) => beginDebugSectionDrag(event, key, 'move')} onFocus={() => setSelectedDebugSection(key)} key={key}>
            <span>{label}</span><button type="button" aria-label={`Resize ${label}`} onPointerDown={(event) => beginDebugSectionDrag(event, key, 'resize')}/>
          </div>
        })}
      </div>}
    </div>
    </div>
    {layoutControlsHost && createPortal(<details className="cbc-debug-controls" style={accentStyle} open={debugCalibrationEnabled}>
      <summary aria-expanded={debugCalibrationEnabled} onClick={(event) => { event.preventDefault(); if (debugCalibrationEnabled) cancelDebugPositioning(); else beginDebugPositioning() }}>Change layout</summary>
    </details>, layoutControlsHost)}
    {debugCalibrationEnabled && layoutPanelHost && createPortal(<div className="cbc-debug-controls cbc-debug-sidebar-controls" style={accentStyle}>
      <div className="cbc-debug-menu">
      <div className="cbc-debug-layout-actions"><button type="button" onClick={cancelDebugPositioning}>Cancel changes</button><button type="button" className="is-primary" onClick={saveDebugPositioning}>Save changes</button></div>
      <div className="cbc-debug-layout-transfer"><button type="button" onClick={() => layoutImportRef.current?.click()}><Icon name="upload"/>Import layout</button><button type="button" onClick={exportDebugLayout}><Icon name="download"/>Export layout</button><input ref={layoutImportRef} type="file" accept="application/json,.json" onChange={(event) => void importDebugLayout(event)}/></div>
      {layoutTransferStatus && <p className="cbc-layout-transfer-status" role="status">{layoutTransferStatus}</p>}
      <fieldset className="cbc-accent-picker"><legend>Card accent</legend><label><span className="cbc-accent-swatch" style={{ background: customAccent ?? elementAccent }}/><input type="color" aria-label="Custom card accent" value={customAccent ?? elementAccent} onChange={(event) => setCustomAccent(event.target.value)}/><output>{(customAccent ?? elementAccent).toUpperCase()}</output></label><button type="button" disabled={!customAccent} onClick={() => setCustomAccent(null)}>Use element color</button></fieldset>
      <label className="cbc-grade-color-option"><input type="checkbox" checked={colorEchoGrades} onChange={(event) => setColorEchoGrades(event.target.checked)}/><span><b>Color Echo rolls</b><small>Color each substat value by its individual roll quality.</small></span></label>
      <fieldset className="cbc-echo-layout-options"><legend>Echo layout</legend><button type="button" className={echoLayoutPreset === 'curved' ? 'is-active' : ''} aria-pressed={echoLayoutPreset === 'curved'} onClick={() => applyEchoLayoutPreset('curved')}>Curved</button><button type="button" className={echoLayoutPreset === 'straight' ? 'is-active' : ''} aria-pressed={echoLayoutPreset === 'straight'} onClick={() => applyEchoLayoutPreset('straight')}>Straight</button></fieldset>
      <div className="cbc-debug-section-list">
        {DEBUG_SECTIONS.map(([key, label]) => <button type="button" className={hiddenDebugSections.has(key) ? 'is-hidden' : ''} aria-pressed={!hiddenDebugSections.has(key)} onClick={() => toggleDebugSection(key)} key={key}><span/>{label}</button>)}
      </div>
      {debugSectionRects[selectedDebugSection] && <section className="cbc-debug-inspector">
        <strong>{DEBUG_SECTIONS.find(([key]) => key === selectedDebugSection)?.[1]}</strong>
        <div>{(['x', 'y', 'width', 'height'] as Array<keyof DebugSectionRect>).map((property) => <label key={property}>{property}<DebugCoordinateInput section={selectedDebugSection} property={property} rect={debugSectionRects[selectedDebugSection]!} onChange={(rect) => updateDebugSectionRect(selectedDebugSection, rect)}/></label>)}</div>
        {selectedDebugSection === 'art' && <label className="cbc-art-zoom"><span>Zoom <output>{artZoom}%</output></span><input type="range" aria-label="Character art zoom" min="100" max={maximumArtZoom} step="1" value={Math.max(100, Math.min(maximumArtZoom, artZoom))} onChange={(event) => updateArtZoom(Number(event.target.value))}/></label>}
        <button type="button" onClick={() => resetDebugSection(selectedDebugSection)}>Reset selected</button>
      </section>}
      <footer><button type="button" onClick={() => setHiddenDebugSections(new Set(DEBUG_SECTIONS.map(([key]) => key)))}>Hide all</button><button type="button" onClick={() => setHiddenDebugSections(new Set<DebugSectionKey>())}>Show all</button><button type="button" onClick={resetAllDebugSections}>Reset layout</button></footer>
      </div>
    </div>, layoutPanelHost)}
  </div>
})

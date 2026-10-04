import { createContext, memo, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { statLabels } from '../game-data/core'
import { echoCatalog } from '../game-data/echoes'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { effectiveSubStats, fixedSecondaryMainStat } from '../game-data/echo-main-stats'
import {
  scoreCharacterSubstats,
  type CharacterSubstatProfile,
  type CharacterSubstatScore
} from '../domain/character-substat-score'
import { substatTierPoints, type EchoRollRating } from '../domain/echo-grade'
import type { Echo, StatKey } from '../domain/types'
import { EchoWaveform } from './EchoWaveform'
import { CalculatedValue, type CalculationDetail } from './CalculationDetails'
import { Icon, PageHeader, Panel } from './primitives'
import { statIconSource } from './stat-icons'
import { useDismissableLayer } from './useDismissableLayer'

export { Icon, PageHeader, Panel } from './primitives'

export const CharacterSubstatProfileContext = createContext<CharacterSubstatProfile | undefined>(undefined)
export const EchoEquipmentContext = createContext<{
  ownedIds: Set<string>
  owners: Map<string, string[]>
  characters: Array<{ id: string; name: string; icon: string }>
  toggle: (echoId: string, characterId: string) => Promise<void>
  clear: (echoId: string) => Promise<void>
} | undefined>(undefined)
const echoCatalogByName = new Map(echoCatalog.map((item) => [item.name, item]))
const normalizedCharacterCatalog = new Map(characterCatalog.map((entry) => [entry.name.toLowerCase().replace(/[^a-z0-9]/g, ''), entry]))

function characterSubstatDetail(score: CharacterSubstatScore, profile: CharacterSubstatProfile): CalculationDetail {
  return {
    title: `${profile.characterName} substat score`,
    value: score.valid && score.grade
      ? `${score.grade} · ${score.percentage.toFixed(1)}%${score.provisional ? '*' : ''}`
      : profile.maximum > 0 ? 'Unverified' : 'Unconfigured',
    formula: 'Sum of (roll tier × character preference weight)',
    equationOperator: '+',
    rows: score.contributions.map((entry) => ({
      label: statLabels[entry.key],
      value: `${entry.tier} × ${entry.weight} = ${entry.points}`
    })),
    note: `${score.points}/${score.maximum} weighted points. ${profile.basis}`
  }
}

export function StatValue({ label, value, accent = false, detail }: { label: string; value: string | number; accent?: boolean; detail?: CalculationDetail }) {
  const output = <strong className={accent ? 'accent' : ''}>{value}</strong>
  return <div className="stat-value"><span>{label}</span>{detail ? <CalculatedValue detail={detail}>{output}</CalculatedValue> : output}</div>
}

export function FilterChips<T extends string | number>({ values, selected, label, hideLabel = false, onChange, renderValue }: {
  values: readonly T[]
  selected: readonly T[]
  label: string
  hideLabel?: boolean
  onChange: (values: T[]) => void
  renderValue?: (value: T) => ReactNode
}) {
  const toggle = (value: T) => {
    if (selected.length === values.length) onChange([value])
    else if (selected.length === 1 && selected.includes(value)) onChange([...values])
    else onChange(selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value])
  }
  return <div className="owned-chip-filter"><span className={hideLabel ? 'sr-only' : undefined}>{label}</span><div className="filter-chips">{values.map((value) => <button type="button" aria-pressed={selected.includes(value)} className={selected.includes(value) ? 'active' : ''} key={value} onClick={() => toggle(value)}>{renderValue?.(value) ?? value}</button>)}</div></div>
}

const elementSonataNames: Record<string, string> = {
  Glacio: 'Freezing Frost',
  Fusion: 'Molten Rift',
  Electro: 'Void Thunder',
  Aero: 'Sierra Gale',
  Spectro: 'Celestial Light',
  Havoc: 'Havoc Eclipse'
}

export function ElementFilterIcon({ element }: { element: string }) {
  const source = generatedSonataIconSources[elementSonataNames[element]]
  return source
    ? <span className="filter-element-icon" title={element}><img src={source} alt={element}/></span>
    : <span>{element}</span>
}

function EchoOwnerPicker({ echo, owners, characters, toggle, clear }: {
  echo: Echo
  owners: string[]
  characters: Array<{ id: string; name: string; icon: string }>
  toggle: (echoId: string, characterId: string) => Promise<void>
  clear: (echoId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismissableLayer(open, ref, close)
  const selected = characters.filter((character) => owners.includes(character.id))
  const names = selected.map((character) => character.name).join(', ')
  return <div className={`echo-owner-picker echo-single-select${open ? ' is-open' : ''}`} ref={ref} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && open) { close(); ref.current?.querySelector<HTMLButtonElement>('.multi-select-trigger')?.focus() } }}>
    <button type="button" className="multi-select-trigger" aria-label={`Equipped by: ${names || 'no characters'}`} title={names || 'Unequipped'} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="multi-select-values">{selected.length ? <><span className="echo-owner-stack" aria-hidden="true">{selected.map((character) => <img src={character.icon} alt="" key={character.id}/>)}</span><em>{names}</em></> : <em>Unequipped</em>}</span><strong aria-hidden="true">⌄</strong></button>
    {open && <div className="echo-single-select-menu echo-owner-options" aria-label={`Equip ${echo.name}`}><button type="button" className={!owners.length ? 'active' : ''} aria-pressed={!owners.length} onClick={() => { void clear(echo.id); close() }}><span className="echo-owner-empty">—</span><span>Unequipped</span></button>{characters.map((character) => <button type="button" className={owners.includes(character.id) ? 'active' : ''} aria-pressed={owners.includes(character.id)} key={character.id} onClick={() => void toggle(echo.id, character.id)}><img src={character.icon} alt=""/><span>{character.name}</span>{owners.includes(character.id) && <span className="echo-owner-check" aria-hidden="true">✓</span>}</button>)}</div>}
  </div>
}

export const EchoMiniCard = memo(function EchoMiniCard({ echo, selected, onClick, actions, equipment, grade, rollRating, scoreLabel }: { echo: Echo; selected?: boolean; onClick?: () => void; actions?: ReactNode; equipment?: ReactNode; grade?: string; rollRating?: EchoRollRating; scoreLabel?: ReactNode }) {
  const characterProfile = useContext(CharacterSubstatProfileContext)
  const equipmentContext = useContext(EchoEquipmentContext)
  const owners = equipmentContext?.owners.get(echo.id) ?? []
  const characterScore = characterProfile ? scoreCharacterSubstats(echo, characterProfile) : undefined
  const catalog = echoCatalogByName.get(echo.name)
  const secondary = fixedSecondaryMainStat(echo)
  const displayedGrade = characterScore
    ? characterScore.valid && characterScore.grade
      ? `${characterScore.grade} · ${characterScore.percentage.toFixed(1)}%${characterScore.provisional ? '*' : ''}`
      : characterProfile && characterProfile.maximum > 0 ? 'UNVERIFIED' : 'UNCONFIGURED'
    : rollRating
    ? rollRating.valid && rollRating.grade
      ? `${rollRating.points}/${rollRating.maximum} · ${rollRating.grade}${rollRating.provisional ? '*' : ''}`
      : 'UNVERIFIED'
    : grade
  const displayedScoreLabel = characterScore ? 'SUBSTAT SCORE' : scoreLabel ?? 'ROLL GRADE'
  const displayedGradeTitle = characterScore?.provisional
    ? `${characterScore.contributions.length}/5 substats revealed · provisional score`
    : rollRating?.provisional
    ? `${rollRating.revealedRolls}/5 rolls revealed · provisional grade`
    : undefined
  const gradeTone = characterScore
    ? characterScore.grade?.toLowerCase()
    : rollRating?.grade?.toLowerCase() ?? grade?.match(/\b(SSS|SS|S|A|B|C|D|E)\b/)?.[1].toLowerCase()
  const scoreDetail = characterScore && characterProfile ? characterSubstatDetail(characterScore, characterProfile) : undefined
  return <article className={`echo-card ${gradeTone ? `has-grade-wave echo-wave-grade-${gradeTone}` : ''} ${selected ? 'selected' : ''} ${echo.excluded ? 'excluded' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } } : undefined}>
    <div className="echo-card-head"><div className="echo-portrait">{catalog?.iconSourceUrl ? <img src={catalog.iconSourceUrl} alt=""/> : <span>◎</span>}<b className={`cost-orb cost-${echo.cost}`}>{echo.cost}</b></div><div className="echo-identity"><h3>{echo.name}</h3><span className="echo-sonata">{generatedSonataIconSources[echo.sonata] && <img src={generatedSonataIconSources[echo.sonata]} alt=""/>}<b>{echo.sonata}</b></span><small>LV. {echo.level} · <b className="echo-stars">{'★'.repeat(echo.rarity)}</b></small></div>{echo.locked && <Icon name="lock" />}</div>
    <div className="echo-main-stats"><div className="main-stat"><span><img className="echo-stat-icon" src={statIconSource(echo.mainStat.key)} alt="" aria-hidden="true"/>{statLabels[echo.mainStat.key]}</span><strong>{formatStat(echo.mainStat.key, echo.mainStat.value)}</strong></div><div className="secondary-main-stat"><span><img className="echo-stat-icon" src={statIconSource(secondary.key)} alt="" aria-hidden="true"/>{statLabels[secondary.key]}</span><strong>{formatStat(secondary.key, secondary.value)}</strong></div></div>
    <div className="substats">{effectiveSubStats(echo).map((stat, index) => { const tier = substatTierPoints(stat.key, stat.value); return <div key={`${stat.key}-${index}`}><span><img className="echo-stat-icon" src={statIconSource(stat.key)} alt="" aria-hidden="true"/>{statLabels[stat.key]}</span><b className={`roll-tier-${tier}`} title={tier ? `Roll tier ${tier}/8` : 'Unknown roll tier'}>{formatStat(stat.key, stat.value)}</b></div> })}</div>
    {gradeTone && <EchoWaveform/>}
    <footer>{displayedGrade && <><span>{displayedScoreLabel}</span>{scoreDetail ? <span className="echo-score-action" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><CalculatedValue detail={scoreDetail}><strong className={`echo-score ${gradeTone ? `grade-${gradeTone}` : ''}`} title={displayedGradeTitle}>{displayedGrade}</strong></CalculatedValue></span> : <strong className={`echo-score ${gradeTone ? `grade-${gradeTone}` : ''}`} title={displayedGradeTitle}>{displayedGrade}</strong>}</>}{actions}</footer>
    {(equipment || equipmentContext?.ownedIds.has(echo.id)) && <div className="echo-equipment">
      {equipmentContext?.ownedIds.has(echo.id) && <EchoOwnerPicker echo={echo} owners={owners} characters={equipmentContext.characters} toggle={equipmentContext.toggle} clear={equipmentContext.clear}/>}
      {equipment}
    </div>}
  </article>
})

export function EquippedCharacterLabel({ name }: { name?: string }) {
  const normalizedName = name?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  const character = normalizedName ? normalizedCharacterCatalog.get(normalizedName) : undefined
  return <span>{character?.iconSourceUrl ? <img src={character.iconSourceUrl} alt=""/> : <i>—</i>}<b>{character?.name ?? name ?? 'Unequipped'}</b></span>
}

export function formatStat(key: StatKey, value: number) {
  return ['hp', 'atk', 'def'].includes(key) ? Math.floor(value + 1e-9).toLocaleString('en-US') : `${value.toFixed(1)}%`
}

export function Confidence({ value }: { value: number }) {
  const level = value >= 0.8 ? 'high' : value >= 0.55 ? 'medium' : 'low'
  return <span className={`confidence ${level}`}>{Math.round(value * 100)}%</span>
}

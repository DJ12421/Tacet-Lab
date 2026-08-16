import { createContext, memo, useContext, type ReactNode } from 'react'
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

export { Icon, PageHeader, Panel } from './primitives'

export const CharacterSubstatProfileContext = createContext<CharacterSubstatProfile | undefined>(undefined)
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

export function FilterChips<T extends string | number>({ values, selected, label, onChange, renderValue }: {
  values: readonly T[]
  selected: readonly T[]
  label: string
  onChange: (values: T[]) => void
  renderValue?: (value: T) => ReactNode
}) {
  const toggle = (value: T) => {
    if (selected.length === values.length) onChange([value])
    else if (selected.length === 1 && selected.includes(value)) onChange([...values])
    else onChange(selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value])
  }
  return <div className="owned-chip-filter"><span>{label}</span><div className="filter-chips">{values.map((value) => <button type="button" aria-pressed={selected.includes(value)} className={selected.includes(value) ? 'active' : ''} key={value} onClick={() => toggle(value)}>{renderValue?.(value) ?? value}</button>)}</div></div>
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

export const EchoMiniCard = memo(function EchoMiniCard({ echo, selected, onClick, actions, equipment, grade, rollRating, scoreLabel }: { echo: Echo; selected?: boolean; onClick?: () => void; actions?: ReactNode; equipment?: ReactNode; grade?: string; rollRating?: EchoRollRating; scoreLabel?: string }) {
  const characterProfile = useContext(CharacterSubstatProfileContext)
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
    <div className="echo-main-stats"><div className="main-stat"><span><i>✦</i>{statLabels[echo.mainStat.key]}</span><strong>{formatStat(echo.mainStat.key, echo.mainStat.value)}</strong></div><div className="secondary-main-stat"><span><i>◆</i>{statLabels[secondary.key]}</span><strong>{formatStat(secondary.key, secondary.value)}</strong></div></div>
    <div className="substats">{effectiveSubStats(echo).map((stat, index) => { const tier = substatTierPoints(stat.key, stat.value); return <div key={`${stat.key}-${index}`}><span><i>{statGlyph(stat.key)}</i>{statLabels[stat.key]}</span><b className={`roll-tier-${tier}`} title={tier ? `Roll tier ${tier}/8` : 'Unknown roll tier'}>{formatStat(stat.key, stat.value)}</b></div> })}</div>
    {gradeTone && <EchoWaveform/>}
    <footer>{displayedGrade && <><span>{displayedScoreLabel}</span>{scoreDetail ? <span className="echo-score-action" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><CalculatedValue detail={scoreDetail}><strong className={`echo-score ${gradeTone ? `grade-${gradeTone}` : ''}`} title={displayedGradeTitle}>{displayedGrade}</strong></CalculatedValue></span> : <strong className={`echo-score ${gradeTone ? `grade-${gradeTone}` : ''}`} title={displayedGradeTitle}>{displayedGrade}</strong>}</>}{actions}</footer>
    {equipment && <div className="echo-equipment">{equipment}</div>}
  </article>
})

export function EquippedCharacterLabel({ name }: { name?: string }) {
  const normalizedName = name?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  const character = normalizedName ? normalizedCharacterCatalog.get(normalizedName) : undefined
  return <span>{character?.iconSourceUrl ? <img src={character.iconSourceUrl} alt=""/> : <i>—</i>}<b>{character?.name ?? name ?? 'Unequipped'}</b></span>
}

function statGlyph(key: StatKey) {
  if (key.includes('crit')) return '✧'
  if (key.includes('Damage')) return '✦'
  if (key.includes('Percent')) return '◇'
  if (key === 'energyRegen') return '↻'
  return '◆'
}

export function formatStat(key: StatKey, value: number) {
  return ['hp', 'atk', 'def'].includes(key) ? Math.floor(value + 1e-9).toLocaleString('en-US') : `${value.toFixed(1)}%`
}

export function Confidence({ value }: { value: number }) {
  const level = value >= 0.8 ? 'high' : value >= 0.55 ? 'medium' : 'low'
  return <span className={`confidence ${level}`}>{Math.round(value * 100)}%</span>
}

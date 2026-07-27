import type { ReactNode } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { statLabels } from '../game-data/core'
import { echoCatalog } from '../game-data/echoes'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { effectiveSubStats, fixedSecondaryMainStat } from '../game-data/echo-main-stats'
import { substatTierPoints, type EchoRollRating } from '../domain/echo-grade'
import type { Echo, StatKey } from '../domain/types'
import { EchoWaveform } from './EchoWaveform'
import { CalculatedValue, type CalculationDetail } from './CalculationDetails'
import { Icon, PageHeader, Panel } from './primitives'

export { Icon, PageHeader, Panel } from './primitives'

export function StatValue({ label, value, accent = false, detail }: { label: string; value: string | number; accent?: boolean; detail?: CalculationDetail }) {
  const output = <strong className={accent ? 'accent' : ''}>{value}</strong>
  return <div className="stat-value"><span>{label}</span>{detail ? <CalculatedValue detail={detail}>{output}</CalculatedValue> : output}</div>
}

export function EchoMiniCard({ echo, selected, onClick, actions, equipment, grade, rollRating, scoreLabel }: { echo: Echo; selected?: boolean; onClick?: () => void; actions?: ReactNode; equipment?: ReactNode; grade?: string; rollRating?: EchoRollRating; scoreLabel?: string }) {
  const catalog = echoCatalog.find((item) => item.name === echo.name)
  const secondary = fixedSecondaryMainStat(echo)
  const displayedGrade = rollRating
    ? rollRating.valid && rollRating.grade
      ? `${rollRating.points}/${rollRating.maximum} · ${rollRating.grade}${rollRating.provisional ? '*' : ''}`
      : 'UNVERIFIED'
    : grade
  const displayedScoreLabel = scoreLabel ?? 'ROLL GRADE'
  const displayedGradeTitle = rollRating?.provisional
    ? `${rollRating.revealedRolls}/5 rolls revealed · provisional grade`
    : undefined
  const gradeTone = rollRating?.grade?.toLowerCase() ?? grade?.match(/\b(SSS|SS|S|A|B|C|D|E)\b/)?.[1].toLowerCase()
  return <article className={`echo-card ${gradeTone ? `has-grade-wave echo-wave-grade-${gradeTone}` : ''} ${selected ? 'selected' : ''} ${echo.excluded ? 'excluded' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } } : undefined}>
    <div className="echo-card-head"><div className="echo-portrait">{catalog?.iconSourceUrl ? <img src={catalog.iconSourceUrl} alt="" loading="lazy"/> : <span>◎</span>}<b className={`cost-orb cost-${echo.cost}`}>{echo.cost}</b></div><div className="echo-identity"><h3>{echo.name}</h3><span className="echo-sonata">{generatedSonataIconSources[echo.sonata] && <img src={generatedSonataIconSources[echo.sonata]} alt="" loading="lazy"/>}<b>{echo.sonata}</b></span><small>LV. {echo.level} · <b className="echo-stars">{'★'.repeat(echo.rarity)}</b></small></div>{echo.locked && <Icon name="lock" />}</div>
    <div className="echo-main-stats"><div className="main-stat"><span><i>✦</i>{statLabels[echo.mainStat.key]}</span><strong>{formatStat(echo.mainStat.key, echo.mainStat.value)}</strong></div><div className="secondary-main-stat"><span><i>◆</i>{statLabels[secondary.key]}</span><strong>{formatStat(secondary.key, secondary.value)}</strong></div></div>
    <div className="substats">{effectiveSubStats(echo).map((stat, index) => { const tier = substatTierPoints(stat.key, stat.value); return <div key={`${stat.key}-${index}`}><span><i>{statGlyph(stat.key)}</i>{statLabels[stat.key]}</span><b className={`roll-tier-${tier}`} title={tier ? `Roll tier ${tier}/8` : 'Unknown roll tier'}>{formatStat(stat.key, stat.value)}</b></div> })}</div>
    {gradeTone && <EchoWaveform/>}
    <footer>{displayedGrade && <><span>{displayedScoreLabel}</span><strong className={`echo-score ${gradeTone ? `grade-${gradeTone}` : ''}`} title={displayedGradeTitle}>{displayedGrade}</strong></>}{actions}</footer>
    {equipment && <div className="echo-equipment">{equipment}</div>}
  </article>
}

export function EquippedCharacterLabel({ name }: { name?: string }) {
  const normalizedName = name?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  const character = normalizedName ? characterCatalog.find((entry) => entry.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName) : undefined
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

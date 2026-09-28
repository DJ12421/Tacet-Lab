import type { AggregatedStats, Echo, Resonator, StatKey, StatLine, Weapon } from '../domain/types'
import { statLabels } from '../game-data'
import { echoStatLines } from '../game-data/echo-main-stats'
import type { CharacterShowcaseModel } from './character-showcase-model'
import type { CalculationDetail, CalculationDetailRow } from './CalculationDetails'

const percentKeys = new Set<StatKey>(['critRate', 'critDamage', 'energyRegen', 'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage', 'spectroDamage', 'fusionDamage', 'glacioDamage', 'electroDamage', 'aeroDamage', 'havocDamage', 'healingBonus'])
const numeric = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 3 })
const damageNumeric = (value: number) => Math.floor(value + 1e-9).toLocaleString('en-US')
const display = (key: StatKey, value: number) => percentKeys.has(key) ? `${numeric(value)}%` : numeric(value)
const sumKey = (lines: StatLine[], key: StatKey) => lines.filter((line) => line.key === key).reduce((sum, line) => sum + line.value, 0)

function sourceRow(label: string, lines: StatLine[], keys: StatKey[]): CalculationDetailRow | undefined {
  const children = keys.flatMap((key) => {
    const value = sumKey(lines, key)
    return value ? [{ label: statLabels[key], value: display(key, value) }] : []
  })
  return children.length ? { label, value: children.length === 1 ? children[0].value : `${children.length} contributions`, children } : undefined
}

export function showcaseStatDetail(model: CharacterShowcaseModel, key: StatKey, label = statLabels[key]): CalculationDetail {
  const final = model.finalStats[key as keyof AggregatedStats]
  const percentKey: StatKey | undefined = key === 'hp' ? 'hpPercent' : key === 'atk' ? 'atkPercent' : key === 'def' ? 'defPercent' : undefined
  const relevant = percentKey ? [key, percentKey] : [key]
  const rows: CalculationDetailRow[] = []
  if (key === 'hp' || key === 'atk' || key === 'def') {
    rows.push({ label: 'Character base', value: numeric(model.characterBaseStats[key]) })
    if (key === 'atk' && model.weapon) rows.push({ label: `${model.weapon.catalog.name} base ATK`, value: numeric(model.weapon.levelStats.baseAtk) })
  } else if (key === 'critRate' || key === 'critDamage') rows.push({ label: 'Character base', value: display(key, model.catalog.baseStats[key]) })
  else if (key === 'energyRegen') rows.push({ label: 'Base Energy Regen', value: '100%' })
  for (const echo of model.equippedEchoes) {
    const row = sourceRow(echo.name, echoStatLines(echo), relevant)
    if (row) rows.push(row)
  }
  if (model.weapon?.secondaryStat) {
    const row = sourceRow(`${model.weapon.catalog.name} secondary stat`, [model.weapon.secondaryStat], relevant)
    if (row) rows.push(row)
  }
  for (const source of model.statBonusSources) {
    const row = sourceRow(source.label, source.lines, relevant)
    if (row) rows.push(row)
  }
  return {
    title: label,
    value: display(key, final),
    formula: percentKey ? `Base × (1 + total ${statLabels[percentKey]} / 100) + flat ${label}` : 'Base value + all applicable contributions',
    equationOperator: '+',
    rows: rows.length ? rows : [{ label: 'No active contribution', value: display(key, final) }],
    note: 'Conditional passive effects are excluded unless the current calculation context explicitly supports them.'
  }
}

export function runtimeStatDetail(resonator: Resonator, weapon: Weapon, echoes: Echo[], key: StatKey, value: number): CalculationDetail {
  const relevant = key === 'hp' ? ['hp', 'hpPercent'] as StatKey[] : key === 'atk' ? ['atk', 'atkPercent'] as StatKey[] : key === 'def' ? ['def', 'defPercent'] as StatKey[] : [key]
  const rows: CalculationDetailRow[] = []
  const baseValue = key === 'atk' ? resonator.baseStats.atk + weapon.baseAtk : key in resonator.baseStats ? resonator.baseStats[key as keyof typeof resonator.baseStats] : 0
  rows.push({ label: 'Character and weapon base', value: display(key, baseValue) })
  const echoRow = sourceRow(`${echoes.length} equipped Echoes`, echoes.flatMap(echoStatLines), relevant)
  if (echoRow) rows.push(echoRow)
  if (weapon.stat) {
    const row = sourceRow('Weapon secondary stat', [weapon.stat], relevant)
    if (row) rows.push(row)
  }
  return { title: statLabels[key], value: display(key, value), formula: relevant.length > 1 ? 'Base × (1 + percent / 100) + flat' : 'Base value + weapon + Echo + active Sonata contributions', equationOperator: '+', rows }
}

export function sumDetail(title: string, value: number, rows: Array<{ label: string; value: number }>, formula = 'Sum of listed values'): CalculationDetail {
  const isDamageTotal = /\b(?:rotation|dps|damage|contribution)\b/i.test(title) && !/\bshare\b/i.test(title)
  return {
    title,
    value: isDamageTotal ? damageNumeric(value) : numeric(value),
    formula,
    equationOperator: formula.includes('÷') ? '÷' : '+',
    rows: rows.map((row) => ({
      label: row.label,
      value: isDamageTotal && !/\bduration\b/i.test(row.label) ? damageNumeric(row.value) : numeric(row.value)
    }))
  }
}

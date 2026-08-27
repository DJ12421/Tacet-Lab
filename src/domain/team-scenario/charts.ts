import type { DamageType, FormulaResultMode } from '../types'

export interface RotationChartRow<TSkillSource extends string = string> {
  buildId: string
  damageType: DamageType
  skillSource: TSkillSource
  normal: number
  critical: number
  expected: number
}

export interface RotationChartAggregation<TSkillSource extends string = string> {
  total: number
  byBuild: Record<string, number>
  byDamageType: Partial<Record<DamageType, number>>
  bySkillSource: Partial<Record<TSkillSource, number>>
}

export function aggregateRotationCharts<TSkillSource extends string>(
  rows: RotationChartRow<TSkillSource>[],
  mode: FormulaResultMode
): RotationChartAggregation<TSkillSource> {
  const result: RotationChartAggregation<TSkillSource> = { total:0, byBuild:{}, byDamageType:{}, bySkillSource:{} }
  for (const row of rows) {
    const value = Number.isFinite(row[mode]) ? row[mode] : 0
    result.total += value
    result.byBuild[row.buildId] = (result.byBuild[row.buildId] ?? 0) + value
    result.byDamageType[row.damageType] = (result.byDamageType[row.damageType] ?? 0) + value
    result.bySkillSource[row.skillSource] = (result.bySkillSource[row.skillSource] ?? 0) + value
  }
  return result
}

import { describe, expect, it } from 'vitest'
import { aggregateRotationCharts } from './charts'

describe('rotation chart aggregation', () => {
  it('keeps damage type and skill source independent', () => {
    const result = aggregateRotationCharts([{
      buildId:'member-1', damageType:'liberation', skillSource:'forte', normal:100, critical:200, expected:150
    }], 'expected')
    expect(result).toEqual({
      total:150,
      byBuild:{ 'member-1':150 },
      byDamageType:{ liberation:150 },
      bySkillSource:{ forte:150 }
    })
  })
})

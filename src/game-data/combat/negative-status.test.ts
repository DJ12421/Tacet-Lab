import { describe, expect, it } from 'vitest'
import { applicableTeamStatusEffects } from './negative-status'

describe('team status availability', () => {
  it('accounts for cross-element application and status consumers', () => {
    expect([...applicableTeamStatusEffects(['1407'])].sort()).toEqual(['aero-erosion', 'spectro-frazzle'])
    expect(applicableTeamStatusEffects(['1507']).has('spectro-frazzle')).toBe(false)
    expect(applicableTeamStatusEffects(['1406']).has('aero-erosion')).toBe(false)
    expect(applicableTeamStatusEffects(['1406', '1506']).has('aero-erosion')).toBe(true)
  })
})

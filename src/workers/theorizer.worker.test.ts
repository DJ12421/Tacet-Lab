import { expect, test } from 'vitest'
import { disabledEquipmentEffectIds, equipmentBuffConditions } from '../domain/combat/runtime'

test('Candidate equipment conditions activate eligible buffs and drop stale Sonata inputs', () => {
  const weapon = { catalogId: '21010036', rank: 1 }
  const sonatas = [{ name: 'Freezing Frost', pieces: 5 }]
  const conditions = equipmentBuffConditions(weapon, sonatas)

  expect(conditions['weapon:21010036:effects:activation:weapon:21010036:effect:1']).toBe(true)
  expect(conditions['sonata:1:sonata:1:5:0']).toBe(3)
  expect(equipmentBuffConditions(weapon, sonatas, {}, ['sonata-effect:sonata:1:sonata:1:5:0'])['sonata:1:sonata:1:5:0']).toBeUndefined()
  expect(equipmentBuffConditions(weapon, [{ name: 'Freezing Frost', pieces: 2 }], conditions)['sonata:1:sonata:1:5:0']).toBeUndefined()
  expect(disabledEquipmentEffectIds(weapon, sonatas, ['sonata-effect:sonata:1:sonata:1:2:0'])).toContain('sonata:1:sonata:1:2:0')
  expect(disabledEquipmentEffectIds(weapon, sonatas, ['weapon-effect:weapon:21010036:weapon:21010036:effect:1']).length).toBeGreaterThan(0)
})

import { describe, expect, it } from 'vitest'
import type { Echo, OwnedCharacter } from '../types'
import { resolveEchoMechanicsV2, skillLevelForAttackV2 } from './context'

const character: OwnedCharacter = {
  id: 'echo-test-character', catalogId: 'echo-test-character', level: 90, sequence: 0,
  skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 1
}

function echo(name: string, rarity: Echo['rarity'] = 5): Echo {
  return {
    id: `echo-${name}`, name, cost: 4, rarity, level: 25, sonata: 'Test Sonata',
    mainStat: { key: 'critRate', value: 22 }, subStats: [], locked: false,
    excluded: false, createdAt: 1, source: 'manual'
  }
}

describe('Calculation V2 main Echo mechanics', () => {
  it('uses Echo rarity as the Echo Skill talent rank', () => {
    const attack = resolveEchoMechanicsV2(echo('Inferno Rider', 4))!.attacks[0]
    expect(skillLevelForAttackV2(character, attack, 4)).toBe(4)
  })

  it('keeps duplicate upstream Echo actions selectable and derives cast timing', () => {
    const mechanics = resolveEchoMechanicsV2(echo('Inferno Rider'))!
    expect(new Set(mechanics.attacks.map((attack) => attack.id)).size).toBe(mechanics.attacks.length)
    expect(mechanics.cooldown).toBe(20)
    expect(mechanics.effects[0]).toMatchObject({ alwaysEnabled: false, duration: 15, trigger: mechanics.attacks[0].key })
  })

  it('automatically enables explicit main-slot passive boosts', () => {
    const mechanics = resolveEchoMechanicsV2(echo('Nightmare: Crownless'))!
    expect(mechanics.effects[0].alwaysEnabled).toBe(true)
    expect(mechanics.cooldown).toBe(12)
  })
})

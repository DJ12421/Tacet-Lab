import { describe, expect, it } from 'vitest'
import { aggregateStats, calculateDamage, calculateRotation, defenseMultiplier, resistanceMultiplier } from './damage'
import type { Build, Echo, Resonator, Team, Weapon } from './types'

const resonators: Resonator[] = ['alpha','beta'].map((id) => ({ id, name: id, element: 'spectro', role: 'test', accent: '#fff', baseStats: { hp: 10000, atk: 412, def: 1000, critRate: 5, critDamage: 150 }, attacks: [{ id: `${id}-attack`, name: 'Test attack', type: 'skill', element: 'spectro', multiplier: 1, hits: 1, scalesWith: 'atk' }] }))
const weapons: Weapon[] = resonators.map((_, index) => ({ id: `weapon-${index}`, name: 'Test weapon', type: 'sword', baseAtk: 587, stat: { key: 'critRate', value: 24.3 } }))

const echo = (id: string, mainKey: Echo['mainStat']['key'], value: number): Echo => ({
  id, name: `Echo ${id}`, cost: 1, rarity: 5, level: 25, sonata: 'Unknown Sonata',
  mainStat: { key: mainKey, value }, subStats: [], locked: false, excluded: false,
  createdAt: 1, source: 'manual'
})

describe('damage pipeline', () => {
  it('aggregates base, percentage, flat, and weapon stats in the correct order', () => {
    const stats = aggregateStats(resonators[0], weapons[0], [echo('a', 'atkPercent', 20), echo('b', 'atk', 100)])
    expect(stats.atk).toBe(Math.floor((412 + 587) * 1.2 + 100))
    expect(stats.critRate).toBeCloseTo(29.3)
  })

  it('uses level defense and piecewise resistance multipliers', () => {
    expect(defenseMultiplier(90, 100)).toBeCloseTo(190 / 390)
    expect(resistanceMultiplier(10)).toBeCloseTo(0.9)
    expect(resistanceMultiplier(-20)).toBeCloseTo(1.1)
    expect(resistanceMultiplier(80)).toBeCloseTo(0.2)
  })

  it('reports normal, critical, and bounded expected damage', () => {
    const stats = aggregateStats(resonators[0], weapons[0], [echo('a', 'critRate', 95)])
    const result = calculateDamage(stats, resonators[0].attacks[0], { level: 100, resistance: 10, damageReduction: 0 })
    expect(result.critical).toBeGreaterThan(result.normal)
    expect(result.expected).toBe(result.critical)
  })

  it('floors calculated stats and each damage result', () => {
    const stats = aggregateStats(resonators[0], weapons[0], [echo('a', 'atkPercent', 6.7)])
    const result = calculateDamage({ ...stats, critRate: 5, critDamage: 150 }, resonators[0].attacks[0], { level: 100, resistance: 10, damageReduction: 0 })
    expect(stats.atk).toBe(Math.floor((412 + 587) * 1.067))
    expect(result.normal).toBe(Math.floor(result.normal))
    expect(result.critical).toBe(Math.floor(result.normal * 1.5))
    expect(result.expected).toBe(Math.floor(result.normal * 1.025))
  })

  it('activates a next-character buff after its trigger and consumes it once', () => {
    const builds: Build[] = resonators.slice(0, 2).map((resonator, index) => ({
      id: `build-${index}`, name: resonator.name, resonatorId: resonator.id, weaponId: weapons[index].id,
      echoIds: [], level: 90, skillLevel: 10
    }))
    const baseTeam: Team = {
      id: 'team', name: 'Team', buildIds: builds.map((build) => build.id),
      enemy: { level: 100, resistance: 10, damageReduction: 0 }, rotationDuration: 10,
      actions: [
        { id: 'trigger', timestamp: 0, buildId: builds[0].id, attackId: resonators[0].attacks[0].id },
        { id: 'buffed', timestamp: 1, buildId: builds[1].id, attackId: resonators[1].attacks[0].id },
        { id: 'unbuffed', timestamp: 2, buildId: builds[1].id, attackId: resonators[1].attacks[0].id }
      ]
    }
    const withoutBuff = calculateRotation(baseTeam, builds, resonators, weapons, [])
    const withBuff = calculateRotation({ ...baseTeam, buffs: [{
      id: 'outro', name: 'Outro ATK', sourceBuildId: builds[0].id, target: 'next',
      triggerAttackId: resonators[0].attacks[0].id, duration: 5, stat: 'atkPercent', value: 20, stackingGroup: 'outro'
    }] }, builds, resonators, weapons, [])
    expect(withBuff.actions[1].expected).toBeGreaterThan(withoutBuff.actions[1].expected)
    expect(withBuff.actions[2].expected).toBeCloseTo(withoutBuff.actions[2].expected)

    const forCharacter = calculateRotation({ ...baseTeam, buffs: [{
      id: 'specific', name: 'Specific ATK', sourceBuildId: builds[0].id, target: 'character', recipientBuildId: builds[1].id,
      triggerAttackId: resonators[0].attacks[0].id, duration: 5, stat: 'atkPercent', value: 20, stackingGroup: 'specific'
    }] }, builds, resonators, weapons, [])
    expect(forCharacter.actions[1].expected).toBeGreaterThan(withoutBuff.actions[1].expected)
    expect(forCharacter.actions[2].expected).toBeGreaterThan(withoutBuff.actions[2].expected)
  })
})

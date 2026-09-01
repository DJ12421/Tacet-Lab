import { describe, expect, it } from 'vitest'
import { characterCatalog, weaponCatalog } from '../../game-data'
import type { Build, OwnedCharacter, OwnedWeapon } from '../types'
import { createBuildCalculationContext } from './context'

describe('build calculation context', () => {
  it('applies Rover: Spectro Sequence 2 exactly once', () => {
    const catalog = characterCatalog.find((entry) => entry.id === '1501')!
    const weaponEntry = weaponCatalog.find((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())!
    const build: Build = {
      id: 'spectro-rover-build',
      name: 'Spectro Rover',
      resonatorId: catalog.id,
      weaponId: 'spectro-rover-weapon',
      echoIds: [],
      level: 90,
      skillLevel: 10
    }
    const weapon: OwnedWeapon = {
      id: build.weaponId,
      catalogId: weaponEntry.id,
      level: 90,
      rank: 1,
      locked: false,
      createdAt: 1
    }
    const character = (sequence: number): OwnedCharacter => ({
      id: 'spectro-rover',
      catalogId: catalog.id,
      level: 90,
      sequence,
      skillLevels: [10, 10, 10, 10, 10],
      enabledSkillTreeBonusIds: [],
      locked: false,
      createdAt: 1
    })
    const targetId = `${catalog.id}:${catalog.attacks[0].id}`
    const context = (sequence: number) => createBuildCalculationContext({
      build,
      character: character(sequence),
      weapon,
      echoes: [],
      enemy: { level: 90, resistance: 10, damageReduction: 0 },
      targetId
    })

    expect(context(2).stats.spectroDamage - context(1).stats.spectroDamage).toBeCloseTo(20)
  })

  it("scopes Bloodpact's Pledge to Resonance Skill damage", () => {
    const catalog = characterCatalog.find((entry) => entry.id === '1406')!
    const weaponEntry = weaponCatalog.find((entry) => entry.id === '21020046')!
    const resonanceSkill = catalog.attacks.find((attack) => attack.type === 'skill')!
    const introSkill = catalog.attacks.find((attack) => attack.type === 'intro')!
    const build: Build = {
      id: 'aero-rover-build',
      name: 'Aero Rover',
      resonatorId: catalog.id,
      weaponId: 'bloodpact',
      echoIds: [],
      level: 90,
      skillLevel: 10
    }
    const character: OwnedCharacter = {
      id: 'aero-rover',
      catalogId: catalog.id,
      level: 90,
      sequence: 0,
      skillLevels: [10, 10, 10, 10, 10],
      enabledSkillTreeBonusIds: [],
      locked: false,
      createdAt: 1
    }
    const weapon: OwnedWeapon = {
      id: build.weaponId,
      catalogId: weaponEntry.id,
      level: 90,
      rank: 1,
      locked: false,
      createdAt: 1
    }
    const context = (attackId: string) => createBuildCalculationContext({
      build,
      character,
      weapon,
      echoes: [],
      enemy: { level: 90, resistance: 10, damageReduction: 0 },
      scenario: {
        resultMode: 'expected',
        memberConditions: { [build.id]: { 'weapon:21020046:0': true } },
        enemyConditions: {},
        selectedTargetByBuild: {}
      },
      targetId: `${catalog.id}:${attackId}`
    })

    expect(context(resonanceSkill.id).inputs.bonusDamage).toBe(10)
    expect(context(introSkill.id).inputs.bonusDamage).toBe(0)
  })

})

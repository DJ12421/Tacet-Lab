import { describe, expect, it } from 'vitest'
import { characterCatalog, weaponCatalog } from '../game-data'
import type { Build, Echo, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { emptyCalculationScenarioV2, resolveCharacterMechanicsV2, resolveEchoMechanicsV2 } from '../domain/calculation-v2'
import { resolveTeamWorkspace } from './team-workspace-model'

describe('team formula workspace', () => {
  it('uses one generated formula target for the member sheet and rotation action', () => {
    const catalog = characterCatalog.find((entry) => entry.attacks.length > 0)!
    const weaponCatalogEntry = weaponCatalog.find((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())!
    const character: OwnedCharacter = { id: 'owned-character', catalogId: catalog.id, level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 1 }
    const weapon: OwnedWeapon = { id: 'owned-weapon', catalogId: weaponCatalogEntry.id, level: 90, rank: 1, locked: false, equippedBy: character.id, createdAt: 1 }
    const echoes: Echo[] = Array.from({ length: 5 }, (_, index) => ({ id: `echo-${index}`, name: `Echo ${index}`, cost: 1, rarity: 5, level: 25, sonata: 'Unknown', mainStat: { key: 'atkPercent', value: 18 }, subStats: [], locked: false, excluded: false, equippedBy: 'build', createdAt: index, source: 'manual' }))
    const build: Build = { id: 'build', name: 'Formula build', resonatorId: catalog.id, weaponId: weapon.id, echoIds: echoes.map((echo) => echo.id), level: 90, skillLevel: 10 }
    const attack = catalog.attacks[0]
    const team: Team = { id: 'team', name: 'Formula team', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 10, actions: [{ id: 'action', timestamp: 0, buildId: build.id, attackId: attack.id, formulaTargetId: `${catalog.id}:${attack.id}` }], scenario: { resultMode: 'expected', memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} } }
    const model = resolveTeamWorkspace({ team, builds: [build], characters: [character], weapons: [weapon], echoes })
    expect(model.members[0].formulaRows.length).toBeGreaterThan(0)
    expect(model.actions[0].formulaTargetId).toBe(`${catalog.id}:${attack.id}`)
    expect(model.actions[0].expected).toBeGreaterThan(0)
    expect(model.actions[0].trace?.operation).toBe('floor')
    expect(model.actions[0].trace?.children[0]?.operation).toBe('prod')
    expect(model.total).toBeCloseTo(model.actions[0].expected)
  })

  it('labels main Echo attacks separately and activates their timed buffs in rotation', () => {
    const catalog = characterCatalog.find((entry) => {
      const candidate: OwnedCharacter = { id: 'candidate', catalogId: entry.id, level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 1 }
      return Boolean(resolveCharacterMechanicsV2(entry, candidate))
    })!
    const weaponCatalogEntry = weaponCatalog.find((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())!
    const character: OwnedCharacter = { id: 'echo-character', catalogId: catalog.id, level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 1 }
    const weapon: OwnedWeapon = { id: 'echo-weapon', catalogId: weaponCatalogEntry.id, level: 90, rank: 1, locked: false, equippedBy: character.id, createdAt: 1 }
    const mainEcho: Echo = { id: 'inferno-main', name: 'Inferno Rider', cost: 4, rarity: 5, level: 25, sonata: 'Molten Rift', mainStat: { key: 'critRate', value: 22 }, subStats: [], locked: false, excluded: false, equippedBy: 'echo-build', createdAt: 1, source: 'manual' }
    const echoes: Echo[] = [mainEcho, ...Array.from({ length: 4 }, (_, index): Echo => ({ id: `support-${index}`, name: `Support ${index}`, cost: 1, rarity: 5, level: 25, sonata: 'Unknown', mainStat: { key: 'atkPercent', value: 18 }, subStats: [], locked: false, excluded: false, equippedBy: 'echo-build', createdAt: index + 2, source: 'manual' }))]
    const build: Build = { id: 'echo-build', name: 'Echo build', resonatorId: catalog.id, weaponId: weapon.id, echoIds: echoes.map((entry) => entry.id), level: 90, skillLevel: 10 }
    const echoAttack = resolveEchoMechanicsV2(mainEcho)!.attacks[0]
    const characterAttack = resolveCharacterMechanicsV2(catalog, character)!.attacks[0]
    const team: Team = {
      id: 'echo-team', name: 'Echo team', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 30,
      actions: [
        { id: 'echo-cast', timestamp: 0, buildId: build.id, attackId: echoAttack.id },
        { id: 'buffed-hit', timestamp: 1, buildId: build.id, attackId: characterAttack.id },
        { id: 'cooldown-cast', timestamp: 10, buildId: build.id, attackId: echoAttack.id },
        { id: 'expired-hit', timestamp: 26, buildId: build.id, attackId: characterAttack.id }
      ],
      calculationV2: emptyCalculationScenarioV2()
    }
    const model = resolveTeamWorkspace({ team, builds: [build], characters: [character], weapons: [weapon], echoes })

    expect(model.members[0].attacks.find((attack) => attack.id === echoAttack.id)).toMatchObject({ group: 'echo', skillLevel: 5, skillName: 'Inferno Rider' })
    expect(model.actions[0].expected).toBeGreaterThan(0)
    expect(model.actions[1].activeSelfEffectsV2.some((effect) => effect.sourceKind === 'echo')).toBe(true)
    expect(model.actions[2].warnings).toContain('Main Echo is still on cooldown (20s).')
    expect(model.actions[3].activeSelfEffectsV2).toHaveLength(0)
  })

  it('groups Resonance Skill attacks by origin instead of damage type', () => {
    const match = characterCatalog.flatMap((catalog) => {
      const candidate: OwnedCharacter = { id: 'candidate', catalogId: catalog.id, level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 1 }
      const attack = resolveCharacterMechanicsV2(catalog, candidate)?.attacks.find((entry) => entry.group === 'Resonance Skill' && entry.type === 'basic')
      return attack ? [{ catalog, attack }] : []
    })[0]!
    const weaponCatalogEntry = weaponCatalog.find((entry) => entry.type.toLowerCase() === match.catalog.weaponType.toLowerCase())!
    const character: OwnedCharacter = { id: 'skill-character', catalogId: match.catalog.id, level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 1 }
    const weapon: OwnedWeapon = { id: 'skill-weapon', catalogId: weaponCatalogEntry.id, level: 90, rank: 1, locked: false, equippedBy: character.id, createdAt: 1 }
    const build: Build = { id: 'skill-build', name: 'Skill build', resonatorId: match.catalog.id, weaponId: weapon.id, echoIds: [], level: 90, skillLevel: 10 }
    const team: Team = { id: 'skill-team', name: 'Skill team', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 10, actions: [], calculationV2: emptyCalculationScenarioV2() }

    const model = resolveTeamWorkspace({ team, builds: [build], characters: [character], weapons: [weapon], echoes: [] })

    expect(model.members[0].attacks.find((attack) => attack.id === match.attack.id)).toMatchObject({ group: 'skill', type: 'basic' })
  })
})

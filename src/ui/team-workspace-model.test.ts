import { expect, it } from 'vitest'
import { combatTargets } from '../domain/combat/runtime'
import type { Build, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { characterCatalog, weaponCatalog } from '../game-data'
import { resolveTeamWorkspace, rotationActionsForTarget, rotationDamageByMode, TEAM_LOOP_TARGET_ID, type TeamActionModel } from './team-workspace-model'

it('keeps team damage results while omitting unused calculation traces', () => {
  const catalog = characterCatalog.find((entry) => combatTargets(entry.id).some((target) => target.kind === 'damage'))!
  const weaponCatalogEntry = weaponCatalog.find((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())!
  const character: OwnedCharacter = { id: 'character', catalogId: catalog.id, level: 90, sequence: 0, locked: false, skillLevels: [10, 10, 10, 10, 10], createdAt: 1 }
  const weapon: OwnedWeapon = { id: 'weapon', catalogId: weaponCatalogEntry.id, level: 90, rank: 1, locked: false, createdAt: 1 }
  const build: Build = { id: 'build', name: 'Test build', characterId: character.id, resonatorId: catalog.id, weaponId: weapon.id, echoIds: [], level: 90, skillLevel: 10 }
  const target = combatTargets(catalog.id).find((entry) => entry.kind === 'damage')!
  const team: Team = { id: 'team', name: 'Test team', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 25, actions: [{ id: 'action', timestamp: 0, buildId: build.id, attackId: catalog.attacks[0]?.id ?? target.id, formulaTargetId: target.id }] }
  team.actions.push({ ...team.actions[0]!, id: 'repeated-action', timestamp: 1 })
  const input = { team, builds: [build], characters: [character], weapons: [weapon], echoes: [] }

  const full = resolveTeamWorkspace(input)
  const lean = resolveTeamWorkspace({ ...input, includeTraces: false })
  const selectedTarget = resolveTeamWorkspace({ ...input, includeTraces: false, formulaTargetIds: [target.id] })
  const rotationOnly = resolveTeamWorkspace({ ...input, includeTraces: false, formulaTargetIds: [] })

  expect(lean.members[0].formulaRows.map(({ normal, critical, expected }) => [normal, critical, expected])).toEqual(full.members[0].formulaRows.map(({ normal, critical, expected }) => [normal, critical, expected]))
  expect(lean.actions.map(({ normal, critical, expected }) => [normal, critical, expected])).toEqual(full.actions.map(({ normal, critical, expected }) => [normal, critical, expected]))
  expect(full.members[0].formulaRows.some((row) => row.traces.expected.stage !== 'unavailable')).toBe(true)
  expect(full.actions[0].traces?.expected).toBeDefined()
  expect(full.actions[0].traces?.expected).toBe(full.actions[1].traces?.expected)
  expect(lean.members[0].formulaRows.every((row) => row.traces.expected.stage === 'unavailable')).toBe(true)
  expect(lean.actions[0].traces?.expected.stage).toBe('unavailable')
  expect(selectedTarget.members[0].formulaRows).toEqual(lean.members[0].formulaRows.filter((row) => row.target.id === target.id))
  expect(rotationOnly.members.every((member) => member.formulaRows.length === 0)).toBe(true)
  expect(rotationOnly.actions.map(({ normal, critical, expected }) => [normal, critical, expected])).toEqual(lean.actions.map(({ normal, critical, expected }) => [normal, critical, expected]))
})

it('counts only complete damage clips between loop markers', () => {
  const action = (id: string, timestamp: number, duration: number, expected: number): TeamActionModel => ({
    action: { id, timestamp, duration, buildId: 'build', attackId: id },
    normal: expected, critical: expected, expected, resultKind: 'damage', activeBuffs: [], activates: [], warnings: []
  })
  const team: Team = { id: 'team', name: 'Loop', buildIds: [], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 10, actions: [], loop: { start: 2, end: 6 } }
  const model = {
    team,
    actions: [action('before', 1, 2, 100), action('inside', 2, 2, 200), action('crosses-end', 5, 2, 300), action('at-end', 5, 1, 400)]
  }

  expect(rotationActionsForTarget(model, TEAM_LOOP_TARGET_ID).map((row) => row.action.id)).toEqual(['inside', 'at-end'])
  expect(rotationDamageByMode(model, TEAM_LOOP_TARGET_ID).expected).toBe(600)
  expect(rotationDamageByMode(model).expected).toBe(1000)
})

it('refreshes a repeated custom buff and expires it at its duration boundary', () => {
  const catalog = characterCatalog.find((entry) => combatTargets(entry.id).some((target) => target.kind === 'damage'))!
  const weaponCatalogEntry = weaponCatalog.find((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())!
  const character: OwnedCharacter = { id: 'character', catalogId: catalog.id, level: 90, sequence: 0, locked: false, skillLevels: [10, 10, 10, 10, 10], createdAt: 1 }
  const weapon: OwnedWeapon = { id: 'weapon', catalogId: weaponCatalogEntry.id, level: 90, rank: 1, locked: false, createdAt: 1 }
  const build: Build = { id: 'build', name: 'Test build', characterId: character.id, resonatorId: catalog.id, weaponId: weapon.id, echoIds: [], level: 90, skillLevel: 10 }
  const attackId = catalog.attacks[0]!.id
  const actions = [0, 0.5, 1.25, 1.5].map((timestamp, index) => ({ id: `action-${index}`, timestamp, buildId: build.id, attackId: index < 2 ? attackId : `${attackId}-other` }))
  const team: Team = { id: 'team', name: 'Test team', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 2, actions,
    buffs: [{ id: 'buff', name: 'ATK', sourceBuildId: build.id, target: 'self', triggerAttackId: attackId, duration: 1, stat: 'atkPercent', value: 10, stackingGroup: 'buff' }] }
  const model = resolveTeamWorkspace({ team, builds: [build], characters: [character], weapons: [weapon], echoes: [], formulaTargetIds: [] })
  expect(model.actions.map((row) => row.activeBuffs.length)).toEqual([0, 1, 1, 0])
  expect(model.actions[0].traces?.expected).not.toBe(model.actions[1].traces?.expected)
})

import { describe, expect, it } from 'vitest'
import {
  createCalculator,
  type ActionMechanics,
  type ActionResult,
  type BaseStats,
  type CalculationOutcome,
  type CombatMember,
  type CombatSetup,
  type EnemyInput,
  type MechanicsRegistry,
  type ResultMode,
  type StatValue
} from './index'

const baseStats: BaseStats = { hp: 1, atk: 1000, def: 1, critRate: 0, critDamage: 1.5, energyRegen: 1 }
const baseEnemy: EnemyInput = { level: 90, resistance: {}, damageReduction: 0 }
const D90 = 1520 / 3032
const expectClose = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 10)

const damageAction = (
  id: string,
  formula: Extract<ActionMechanics['formula'], { kind: 'damage' }>,
  overrides: Partial<ActionMechanics> = {}
): ActionMechanics => ({
  id,
  sourceId: `fixture:${id}`,
  reviewFingerprint: `fixture:${id}:reviewed`,
  kind: 'damage',
  damageType: 'skill',
  element: 'spectro',
  formula,
  ...overrides
})

const fixedAction = (id = 'observe', value = 0): ActionMechanics => ({
  id,
  sourceId: `fixture:${id}`,
  reviewFingerprint: `fixture:${id}:reviewed`,
  kind: 'damage',
  damageType: 'skill',
  element: 'spectro',
  formula: { kind: 'fixed-damage', hits: [value] }
})

interface FixtureOptions {
  stats?: Partial<BaseStats>
  weaponAtk?: number
  weaponStats?: readonly StatValue[]
  echoes?: readonly StatValue[]
  actions?: readonly ActionMechanics[]
  enemy?: Partial<EnemyInput>
  sequence?: number
  skillLevels?: readonly number[]
  weaponRank?: number
  mainEchoId?: string
  selections?: Readonly<Record<string, boolean | number | string>>
}

function fixture(options: FixtureOptions = {}) {
  const actions = options.actions ?? [fixedAction()]
  const registry: MechanicsRegistry = {
    dataVersion: 'fixture-v1',
    characters: {
      character: {
        id: 'character',
        sourceId: 'fixture:character',
        reviewFingerprint: 'fixture:character:reviewed',
        levelStats: [{ level: 90, ...baseStats, ...options.stats }],
        actions: Object.fromEntries(actions.map((action) => [action.id, action]))
      }
    },
    weapons: {
      weapon: {
        id: 'weapon',
        sourceId: 'fixture:weapon',
        reviewFingerprint: 'fixture:weapon:reviewed',
        levelStats: [{ level: 90, atk: options.weaponAtk ?? 0 }],
        stats: options.weaponStats
      }
    }
  }
  const member: CombatMember = {
    memberId: 'actor',
    character: { id: 'character', level: 90, sequence: options.sequence ?? 0, skillLevels: options.skillLevels ?? [] },
    weapon: { id: 'weapon', level: 90, rank: options.weaponRank ?? 1 },
    echoes: (options.echoes ?? []).map((line, index) => ({
      instanceId: `echo-${index}`,
      catalogId: `fixture-echo-${index}`,
      rarity: 5,
      level: 0,
      sonataId: `fixture-none-${index}`,
      mainStat: line,
      substats: []
    })),
    mainEchoId: options.mainEchoId
  }
  const enemy: EnemyInput = {
    ...baseEnemy,
    ...options.enemy,
    resistance: { ...baseEnemy.resistance, ...options.enemy?.resistance }
  }
  const calculator = createCalculator(registry)
  const setup: CombatSetup = { dataVersion: registry.dataVersion, members: [member], enemy, selections: options.selections ?? {} }
  const calculate = (actionId = actions[0].id, resultMode: ResultMode = 'normal', request: { trace?: boolean } = {}) => calculator.calculateAction({
    setup,
    actorId: member.memberId,
    actionId,
    resultMode,
    ...request
  })
  return { calculator, calculate, member, registry, setup }
}

function valueOf(result: CalculationOutcome<ActionResult>) {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.errors[0]?.message)
  return result.value
}

describe('combat Step 3 public interface fixtures', () => {
  it('resolves a reviewed main Echo formula by rarity and applies its flat damage', () => {
    const context = fixture({ echoes:[{ stat:'atk', mode:'flat', value:0 }], mainEchoId:'echo-0' })
    context.registry.echoes = {
      'fixture-echo-0': {
        id:'fixture-echo-0', name:'Vanguard Junrock', description:'Physical Echo DMG.',
        sourceId:'fixture:echo', reviewFingerprint:'echo-reviewed', cooldownSeconds:8, effects:[],
        actions:{ 'echo:skill': {
          id:'echo:skill', name:'Echo Skill', description:'20% + 50 Physical DMG.',
          sourceId:'fixture:echo:skill', reviewFingerprint:'echo-skill-reviewed', kind:'damage', damageType:'echo', element:'physical',
          formulas:{ 5:{ kind:'damage', scaling:{ atk:1 }, hits:[0.2], flatHits:[50], canCrit:true } }
        } }
      }
    }
    const result = valueOf(context.calculate('echo:skill'))
    expect(result.damageType).toBe('echo')
    expectClose(result.selected, 250 * D90)
  })

  it('rejects a main Echo rotation that reuses the Nanoka cooldown too early', () => {
    const context = fixture({ echoes:[{ stat:'atk', mode:'flat', value:0 }], mainEchoId:'echo-0' })
    context.registry.echoes = {
      'fixture-echo-0': {
        id:'fixture-echo-0', name:'Echo', description:'', sourceId:'fixture:echo', reviewFingerprint:'echo-reviewed', cooldownSeconds:8, effects:[],
        actions:{ 'echo:skill': {
          id:'echo:skill', name:'Echo Skill', description:'', sourceId:'fixture:echo:skill', reviewFingerprint:'echo-skill-reviewed',
          kind:'damage', damageType:'echo', element:'physical', formulas:{ 5:{ kind:'damage', scaling:{ atk:1 }, hits:[0.2], canCrit:true } }
        } }
      }
    }
    const result = context.calculator.calculateRotation({
      setup:context.setup, duration:10, resultMode:'normal',
      actions:[
        { id:'first', actorId:'actor', actionId:'echo:skill', timestamp:0 },
        { id:'early', actorId:'actor', actionId:'echo:skill', timestamp:7 }
      ]
    })
    expect(result).toMatchObject({ ok:false, errors:[{ code:'invalid-rotation' }] })
  })

  it('F01, F02, and F03 aggregate base, percentage, and flat primary stats', () => {
    const atk = valueOf(fixture({
      stats: { atk: 500.9 },
      weaponAtk: 300.9,
      echoes: [
        { stat: 'atk', mode: 'percent', value: 0.30 },
        { stat: 'atk', mode: 'flat', value: 75.25 }
      ]
    }).calculate())
    expect(atk.stats.baseAtk).toBe(800)
    expect(atk.stats.atk).toBe(1115.25)

    const hp = valueOf(fixture({
      stats: { hp: 10000.9 },
      echoes: [
        { stat: 'hp', mode: 'percent', value: 0.20 },
        { stat: 'hp', mode: 'flat', value: 500.5 }
      ]
    }).calculate())
    expect(hp.stats.baseHp).toBe(10000)
    expect(hp.stats.hp).toBe(12500.5)

    const def = valueOf(fixture({
      stats: { def: 1200.9 },
      echoes: [
        { stat: 'def', mode: 'percent', value: 0.15 },
        { stat: 'def', mode: 'flat', value: 90.25 }
      ]
    }).calculate())
    expect(def.stats.baseDef).toBe(1200)
    expect(def.stats.def).toBe(1470.25)
  })

  it('F04-F08 calculate ATK, HP, DEF, hybrid, and Energy Regen scaling', () => {
    const actions = [
      damageAction('F04', { kind: 'damage', scaling: { atk: 1 }, hits: [1.2], canCrit: false }),
      damageAction('F05', { kind: 'damage', scaling: { hp: 1 }, hits: [0.1], canCrit: false }),
      damageAction('F06', { kind: 'damage', scaling: { def: 1 }, hits: [0.8], canCrit: false }),
      damageAction('F07', { kind: 'damage', scaling: { atk: 0.5, hp: 0.02, def: 0.1 }, hits: [1], canCrit: false }),
      damageAction('F08', { kind: 'damage', scaling: { energyRegen: 2 }, hits: [1], canCrit: false })
    ]
    const run = fixture({ stats: { atk: 1000, hp: 20000, def: 1500, energyRegen: 1.5 }, actions }).calculate
    expectClose(valueOf(run('F04')).selected, 1200 * D90)
    expectClose(valueOf(run('F05')).selected, 2000 * D90)
    expectClose(valueOf(run('F06')).selected, 1200 * D90)

    const hybrid = fixture({ stats: { atk: 1000, hp: 10000, def: 1000 }, actions }).calculate
    expectClose(valueOf(hybrid('F07')).selected, 800 * D90)
    expectClose(valueOf(run('F08')).selected, 300 * D90)
  })

  it('F09 preserves real-hit precision before summing the action', () => {
    const action = damageAction('F09', { kind: 'damage', scaling: { atk: 1 }, hits: [0.333, 0.333, 0.334], canCrit: false })
    const result = valueOf(fixture({ actions: [action] }).calculate('F09'))
    result.hits.forEach((hit, index) => expectClose(hit, 1000 * [0.333, 0.333, 0.334][index] * D90))
    expectClose(result.selected, 1000 * D90)
  })

  it('F10 calculates normal, critical, and expected values from unrounded pre-crit damage', () => {
    const action = damageAction('F10', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: true })
    const result = valueOf(fixture({ stats: { critRate: 0.25, critDamage: 1.5 }, actions: [action] }).calculate('F10'))
    expectClose(result.totals.normal, 1000 * D90)
    expectClose(result.totals.critical, 1500 * D90)
    expectClose(result.totals.expected, 1125 * D90)
  })

  it('F11-F13 keep bonus, amplification, vulnerability, and final damage in separate factors', () => {
    const actions = [
      damageAction('F11', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: false, damageBonuses: [0.10, 0.20, 0.30, 0.05] }),
      damageAction('F12', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: false, amplifications: [0.10, 0.20] }),
      damageAction('F13', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: false, vulnerabilities: [0.20], finalDamageBonuses: [0.10] })
    ]
    const run = fixture({ actions }).calculate
    expectClose(valueOf(run('F11')).selected, 1000 * 1.65 * D90)
    expectClose(valueOf(run('F12')).selected, 1000 * 1.30 * D90)
    expectClose(valueOf(run('F13')).selected, 1000 * 1.20 * 1.10 * D90)
  })

  it('F14 rejects generic flat ordinary damage', () => {
    const action: ActionMechanics = { id: 'F14', sourceId: 'fixture:F14', reviewFingerprint: 'fixture:F14:reviewed', kind: 'damage', damageType: 'skill', element: 'spectro', formula: { kind: 'unsupported', family: 'generic-flat-damage' } }
    const result = fixture({ actions: [action] }).calculate('F14')
    expect(result).toMatchObject({ ok: false, errors: [{ code: 'unsupported-mechanic', sourceId: 'fixture:F14', actorId: 'actor', actionId: 'F14' }], warnings: [] })
  })

  it('F15-F16 apply levels, defence reduction, and defence ignore', () => {
    const action = damageAction('defence', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: false })
    const status = damageAction('status', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: false }, { damageType:'status' })
    expectClose(valueOf(fixture({ actions: [action] }).calculate('defence')).selected, 1000 * D90)
    expectClose(valueOf(fixture({ actions: [action], enemy: { level: 100 } }).calculate('defence')).selected, 1000 * 1520 / (1520 + 1592))
    expectClose(valueOf(fixture({ actions: [action], enemy: { defenseReduction: 0.20 } }).calculate('defence')).selected, 1000 * 1520 / (1520 + 1512 * 0.8))
    expectClose(valueOf(fixture({ actions: [action], enemy: { defenseIgnore: 0.30 } }).calculate('defence')).selected, 1000 * 1520 / (1520 + 1512 * 0.7))
    expectClose(valueOf(fixture({ actions: [action], enemy: { defenseReduction: 0.20, defenseIgnore: 0.30 } }).calculate('defence')).selected, 1000 * 1520 / (1520 + 1512 * 0.8 * 0.7))
    expectClose(valueOf(fixture({ actions: [status], enemy: { defenseIgnore: 0.30 } }).calculate('status')).selected, 1000 * D90)
    expectClose(valueOf(fixture({ actions: [status], enemy: { defenseReduction: 0.20, defenseIgnore: 0.30 } }).calculate('status')).selected, 1000 * 1520 / (1520 + 1512 * 0.8))
  })

  it('F17-F18 apply every accepted resistance branch', () => {
    const action = damageAction('resistance', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: false })
    const run = (resistance: number, reduction = 0, ignore = 0) => valueOf(fixture({ actions: [action], enemy: { resistance: { spectro: resistance }, resistanceReduction: reduction, resistanceIgnore: ignore } }).calculate('resistance')).selected
    expectClose(run(-0.20), 1000 * D90 * 1.20)
    expectClose(run(0.10), 1000 * D90 * 0.90)
    expectClose(run(0.80), 1000 * D90 * 0.20)
    expectClose(run(0.90), 1000 * D90 * 0.10)
    expectClose(run(0.10, 0.15, 0.05), 1000 * D90 * 1.05)
    expectClose(run(-0.10, 0.20), 1000 * D90 * 1.20)
  })

  it('F19 rejects enemy damage reduction', () => {
    const action = damageAction('F19', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: false })
    const result = fixture({ actions: [action], enemy: { damageReduction: 0.25 } }).calculate('F19')
    expect(result).toMatchObject({ ok: false, errors: [{ code: 'unsupported-mechanic', sourceId: 'fixture:F19', actorId: 'actor', actionId: 'F19' }], warnings: [] })
  })

  it('F20 fixed damage bypasses crit and enemy multipliers', () => {
    const result = valueOf(fixture({
      stats: { critRate: 1, critDamage: 3 },
      actions: [fixedAction('F20', 1234.75)],
      enemy: { resistance: { spectro: 0.80 }, damageReduction: 0.25 }
    }).calculate('F20'))
    expect(result.totals).toEqual({ normal: 1234.75, critical: 1234.75, expected: 1234.75 })
  })

  it('F21-F22 calculate healing and shield strength', () => {
    const healing: ActionMechanics = { id: 'F21', sourceId: 'fixture:F21', reviewFingerprint: 'fixture:F21:reviewed', kind: 'healing', formula: { kind: 'healing', scaling: { hp: 1 }, motionValue: 0.10, flatValue: 500, bonuses: [0.20] } }
    const shield: ActionMechanics = { id: 'F22', sourceId: 'fixture:F22', reviewFingerprint: 'fixture:F22:reviewed', kind: 'shield', formula: { kind: 'shield', scaling: { def: 1 }, motionValue: 0.50, flatValue: 250, bonuses: [0.30] } }
    const run = fixture({ stats: { hp: 20000, def: 1500 }, actions: [healing, shield] }).calculate
    expect(valueOf(run('F21')).selected).toBe(3000)
    expect(valueOf(run('F22')).selected).toBe(1300)
  })

  it('F23 fails closed and never returns a partial value', () => {
    const action: ActionMechanics = { id: 'F23', sourceId: 'fixture:unsupported:damage-from-shield-strength', reviewFingerprint: 'fixture:F23:reviewed', kind: 'damage', formula: { kind: 'unsupported', family: 'damage-from-shield-strength' } }
    const result = fixture({ actions: [action] }).calculate('F23')
    expect(result).toEqual({
      ok: false,
      errors: [{
        code: 'unsupported-mechanic',
        message: 'Formula family damage-from-shield-strength is unsupported.',
        sourceId: 'fixture:unsupported:damage-from-shield-strength',
        actorId: 'actor',
        actionId: 'F23'
      }],
      warnings: []
    })
  })

  it('trace mode observes the same calculation path without changing values', () => {
    const action = damageAction('trace', { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: true })
    const run = fixture({ stats: { critRate: 0.25 }, actions: [action] }).calculate
    const withoutTrace = valueOf(run('trace'))
    const withTrace = valueOf(run('trace', 'normal', { trace: true }))
    expect(withTrace.totals).toEqual(withoutTrace.totals)
    expect(withTrace.hits).toEqual(withoutTrace.hits)
    expect(withTrace.trace?.stage).toBe('damage')
  })

  it('fails closed for mechanics reserved for later milestones', () => {
    expect(fixture({ skillLevels: [10] }).calculate()).toMatchObject({ ok: false, errors: [{ code: 'unsupported-mechanic' }] })
    expect(fixture({ mainEchoId: 'echo-0' }).calculate()).toMatchObject({ ok: false, errors: [{ code: 'invalid-input' }] })
    expect(fixture({ selections: { active: true } }).calculate()).toMatchObject({ ok: false, errors: [{ code: 'missing-mechanic' }] })
  })
})

import { describe, expect, it } from 'vitest'
import {
  createCalculator,
  type ActionMechanics,
  type CombatSetup,
  type MechanicsRegistry,
  type RotationRequest
} from './index'

const damageAction = (id: string, damageType: ActionMechanics['damageType'], motionValue: number): ActionMechanics => ({
  id,
  sourceId: `fixture:${id}`,
  reviewFingerprint: `fixture:${id}:reviewed`,
  kind: 'damage',
  damageType,
  element: 'spectro',
  formula: { kind: 'damage', scaling: { atk: 1 }, hits: [motionValue], canCrit: false }
})

const actions = [damageAction('skill', 'skill', 1), damageAction('basic', 'basic', 0.5)]
const D90 = 1520 / 3032
const expectClose = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 10)
const registry: MechanicsRegistry = {
  dataVersion: 'rotation-v1',
  characters: {
    character: {
      id: 'character', sourceId: 'fixture:character', reviewFingerprint: 'character-reviewed',
      levelStats: [{ level: 90, hp: 1, atk: 1000, def: 1, critRate: 0, critDamage: 1.5, energyRegen: 1 }],
      actions: Object.fromEntries(actions.map((action) => [action.id, action])),
      effects: [{
        id: 'buff', sourceId: 'fixture:buff', reviewFingerprint: 'buff-reviewed', recipient: 'self',
        activation: { kind: 'toggle', input: 'buff' }, operations: [{ kind: 'add-damage-bonus', value: 0.2 }]
      }]
    }
  },
  weapons: {
    weapon: { id: 'weapon', sourceId: 'fixture:weapon', reviewFingerprint: 'weapon-reviewed', levelStats: [{ level: 90, atk: 0 }] }
  }
}
const setup: CombatSetup = {
  dataVersion: registry.dataVersion,
  members: [{
    memberId: 'actor',
    character: { id: 'character', level: 90, sequence: 0, skillLevels: [] },
    weapon: { id: 'weapon', level: 90, rank: 1 },
    echoes: []
  }],
  enemy: { level: 90, resistance: {}, damageReduction: 0 },
  selections: {}
}
const calculator = createCalculator(registry)
const rotate = (overrides: Partial<RotationRequest> = {}) => calculator.calculateRotation({
  setup,
  duration: 10,
  resultMode: 'normal',
  actions: [{ id: 'one', actorId: 'actor', actionId: 'skill', timestamp: 0 }],
  ...overrides
})

describe('combat Step 5 rotations', () => {
  it('uses the same action path for a one-action rotation', () => {
    const direct = calculator.calculateAction({ setup, actorId: 'actor', actionId: 'skill', resultMode: 'normal' })
    const rotation = rotate()
    expect(direct.ok && rotation.ok && rotation.value.actions[0].selected).toBe(direct.ok ? direct.value.selected : -1)
  })

  it('orders equal timestamps stably and aggregates repetitions', () => {
    const result = rotate({ actions: [
      { id: 'late', actorId: 'actor', actionId: 'basic', timestamp: 5, repetitions: 2 },
      { id: 'first', actorId: 'actor', actionId: 'skill', timestamp: 1 },
      { id: 'second', actorId: 'actor', actionId: 'basic', timestamp: 1 }
    ] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.actions.map((entry) => entry.commandId)).toEqual(['first', 'second', 'late'])
    result.value.actions.map((entry) => entry.selected).forEach((value, index) => expectClose(value, [1000, 500, 1000][index] * D90))
    expectClose(result.value.total, 2500 * D90)
    expectClose(result.value.dps, 250 * D90)
    expectClose(result.value.byActor.actor, 2500 * D90)
    expectClose(result.value.byDamageType.skill, 1000 * D90)
    expectClose(result.value.byDamageType.basic, 1500 * D90)
  })

  it('passes command inputs through reviewed effect resolution', () => {
    const result = rotate({ actions: [{ id: 'buffed', actorId: 'actor', actionId: 'skill', timestamp: 0, inputs: { buff: true } }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectClose(result.value.total, 1200 * D90)
  })

  it('fails closed for invalid timelines and action failures', () => {
    expect(rotate({ duration: 0 })).toMatchObject({ ok: false, errors: [{ code: 'invalid-rotation' }] })
    expect(rotate({ actions: [{ id: 'one', actorId: 'actor', actionId: 'skill', timestamp: 11 }] })).toMatchObject({ ok: false, errors: [{ code: 'invalid-rotation' }] })
    expect(rotate({ actions: [{ id: 'one', actorId: 'actor', actionId: 'skill', timestamp: 0, duration: 0 }] })).toMatchObject({ ok: false, errors: [{ code: 'invalid-rotation' }] })
    expect(rotate({ actions: [{ id: 'same', actorId: 'actor', actionId: 'skill', timestamp: 0 }, { id: 'same', actorId: 'actor', actionId: 'basic', timestamp: 1 }] })).toMatchObject({ ok: false, errors: [{ code: 'invalid-rotation' }] })
    expect(rotate({ actions: [{ id: 'missing', actorId: 'actor', actionId: 'unknown', timestamp: 0 }] })).toMatchObject({ ok: false, errors: [{ code: 'missing-mechanic' }] })
  })

  it('keeps trace mode observational', () => {
    const plain = rotate()
    const traced = rotate({ trace: true })
    expect(plain.ok && traced.ok && traced.value.total).toBe(plain.ok ? plain.value.total : -1)
    expect(traced.ok && traced.value.trace?.stage).toBe('rotation')
  })
})

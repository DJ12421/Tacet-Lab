import { describe, expect, it } from 'vitest'
import { State } from './engine/state.js'
import { applyTeam, equip, runningAction, withTeam } from './engine/context.js'
import { Buff, Gear } from './engine/gear.js'
import { YANGYANG, YANGYANG_ACTIONS } from './resonators/aero/yangyang.js'
import { YINLIN, YINLIN_ACTIONS } from './resonators/electro/yinlin.js'
import { runTimeline, toFrame } from './timeline'
import { Action } from './engine/rotation.js'
import { Attribute, Scaling, Stat, Type } from './engine/stats.js'

describe('manual combat timeline', () => {
  it('rounds saved seconds to the nearest combat frame', () => {
    expect(toFrame(0)).toBe(0)
    expect(toFrame(1 / 60)).toBe(1)
    expect(toFrame(1.5)).toBe(90)
    expect(() => toFrame(-0.1)).toThrow(RangeError)
    expect(() => toFrame(Number.NaN)).toThrow(RangeError)
  })

  it('does not create damage in an empty window', () => {
    expect(runTimeline(new State([]), [], 0).hits).toEqual([])
  })

  it('resolves a level 90 basic hit at its authored frame', () => {
    const state = new State(['fixture'])
    state.enemyLevel = 100
    state.enemyResistance = 20
    withTeam(state, () => equip(YANGYANG.resonator))
    const action = YANGYANG_ACTIONS['1402-1-0']!
    const result = runTimeline(state, [{ id: 'basic-1', member: 0, action, timestamp: 0 }], 1)
    const raw = 0.4473 * 250 * 0.8 * (1520 / (1520 + 1592))
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]?.avg).toBe(Math.floor(raw * 1.025))
    expect(result.hits[0]?.normal).toBe(Math.floor(raw))
    expect(result.hits[0]?.critical).toBe(Math.floor(raw * 1.5))
  })

  it('applies the configured enemy damage reduction to every result mode', () => {
    const state = new State(['fixture'])
    state.enemyLevel = 100
    state.enemyResistance = 20
    state.enemyDamageReduction = 10
    withTeam(state, () => equip(YANGYANG.resonator))
    const result = runTimeline(state, [{ id: 'basic-1', member: 0, action: YANGYANG_ACTIONS['1402-1-0']!, timestamp: 0 }], 1)
    const raw = 0.4473 * 250 * 0.8 * (1520 / (1520 + 1592)) * 0.9
    expect(result.hits[0]?.normal).toBe(Math.floor(raw))
    expect(result.hits[0]?.critical).toBe(Math.floor(raw * 1.5))
    expect(result.hits[0]?.avg).toBe(Math.floor(raw * 1.025))
  })

  it('rejects an animation that exceeds the saved rotation window', () => {
    const state = new State(['fixture'])
    withTeam(state, () => equip(YANGYANG.resonator))
    expect(() => runTimeline(state, [{ id: 'late', member: 0, action: YANGYANG_ACTIONS['1402-1-0']!, timestamp: 0 }], 0))
      .toThrow('Cast animation extends past the rotation duration.')
  })

  it('reserves the swap delay inside a saved gap', () => {
    const state = new State(['first', 'second'])
    withTeam(state, () => equip(YANGYANG.resonator))
    state.active = 1
    withTeam(state, () => equip(YINLIN.resonator))
    state.active = 0
    const first = YANGYANG_ACTIONS['1402-1-0']!
    const second = YINLIN_ACTIONS['1302-1-0']!
    const result = runTimeline(state, [
      { id: 'first', member: 0, action: first, timestamp: 0 },
      { id: 'second', member: 1, action: second, timestamp: 33 / 60 }
    ], 1)
    expect(result.rows.find((row) => row.action === second)?.realStarts).toBe(33)
  })

  it('uses the owned level for negative status damage', () => {
    const state = new State(['fixture'])
    state.slots[0]!.level = 80
    state.enemyLevel = 90
    withTeam(state, () => equip(YANGYANG.resonator))
    const action = new Action('Status fixture', {
      element: Attribute.Aero, type: Type.Status, scaling: Scaling.Dot, castPriority: 1, animFrames: 1,
      bullets: [{ hitFrame: 0, mv: 10000 }]
    })
    const result = runTimeline(state, [
      { id: 'basic', member: 0, action: YANGYANG_ACTIONS['1402-1-0']!, timestamp: 0 },
      { id: 'status', member: 0, action, timestamp: 1 }
    ], 2)
    expect(result.hits.at(-1)?.avg).toBe(Math.floor(2005 * 1440 / (1440 + 1512)))
  })

  it('uses the local Tune table at the owned level', () => {
    const state = new State(['fixture'])
    state.slots[0]!.level = 80
    state.enemyLevel = 90
    state.enemyResistance = 10
    withTeam(state, () => equip(YANGYANG.resonator))
    const action = new Action('Tune fixture', {
      element: Attribute.Physical, type: Type.Break, scaling: Scaling.Tune, castPriority: 1, animFrames: 1,
      bullets: [{ hitFrame: 0, mv: 10000 }]
    })
    const result = runTimeline(state, [
      { id: 'basic', member: 0, action: YANGYANG_ACTIONS['1402-1-0']!, timestamp: 0 },
      { id: 'tune', member: 0, action, timestamp: 1 }
    ], 2)
    expect(result.hits.at(-1)?.avg).toBe(Math.floor(Math.floor(437.085 * 14) * 1440 / (1440 + 1512) * 0.9))
  })

  it('applies a teammate buff while its combat clock is live', () => {
    const first = YANGYANG_ACTIONS['1402-1-0']!
    const second = YINLIN_ACTIONS['1302-1-0']!
    const run = (buffed: boolean) => {
      const state = new State(['first', 'second'])
      const buff = new Buff({ duration: 60, stats: [[Stat.DmgBonus, 20]] })
      state.active = 0
      withTeam(state, () => {
        equip(YANGYANG.resonator)
        if (buffed) equip(new Gear({ updateBuffs: () => { if (runningAction(first)) applyTeam(buff) } }))
      })
      state.active = 1
      withTeam(state, () => equip(YINLIN.resonator))
      state.active = 0
      return runTimeline(state, [
        { id: 'first', member: 0, action: first, timestamp: 0 },
        { id: 'second', member: 1, action: second, timestamp: 33 / 60 }
      ], 1).hits.at(-1)!.avg
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

import { describe, expect, it } from 'vitest'
import { createOptimizerWorkPlan, optimizeBuildPartition, optimizeBuilds, optimizeOptimizerWorkUnit } from './optimizer'
import type { Echo, OptimizerProfile, OptimizerRequest, Resonator, Weapon } from './types'

const resonator: Resonator = { id: 'test', name: 'Test', element: 'spectro', role: 'test', accent: '#fff', baseStats: { hp: 10000, atk: 400, def: 1000, critRate: 5, critDamage: 150 }, attacks: [{ id: 'attack', name: 'Attack', type: 'skill', element: 'spectro', multiplier: 1, hits: 1, scalesWith: 'atk' }] }
const weapon: Weapon = { id: 'weapon', name: 'Weapon', type: 'sword', baseAtk: 500, stat: { key: 'critRate', value: 24.3 } }

function makeEcho(id: string, crit: number, locked = false): Echo {
  return { id, name: id, cost: 1, rarity: 5, level: 25, sonata: 'Celestial Light', mainStat: { key: 'critRate', value: crit }, subStats: [], locked, excluded: false, createdAt: 1, source: 'manual' }
}

describe('optimizer', () => {
  const request = (echoes: Echo[]): OptimizerRequest => ({
    requestId: 'test', echoes, resonator, weapon, attack: resonator.attacks[0],
    enemy: { level: 100, resistance: 10, damageReduction: 0 }, objective: 'critRate', minimumStats: {}, limit: 20
  })
  const profile = (mainEchoPolicy: OptimizerProfile['mainEchoPolicy'] = 'current'): OptimizerProfile => ({
    id: 'optimizer-test', buildId: 'build', levelLow: 0, levelHigh: 25, rarities: [5],
    mainStatsByCost: { '1': ['critRate'], '3': [], '4': [] }, excludedEchoIds: [], equippedPolicy: 'current', teamBuildIds: [],
    mainEchoPolicy, allowedSonatas: ['Celestial Light'], sonataMode: 'any', allowNoSonata: true, requiredSonataEffects: [],
    minimumStats: {}, maximumStats: {}, resultLimit: 20, plotStat: 'critRate', workerCount: 2, searchMode: 'exact',
    maxEvaluations: 100_000, allowPartial: false, updatedAt: 1
  })

  it('matches the exhaustive best five on a small inventory', () => {
    const echoes = [1, 2, 3, 4, 5, 6].map((value) => makeEcho(String(value), value))
    const results = optimizeBuilds(request(echoes))
    expect(results[0].echoIds.sort()).toEqual(['2', '3', '4', '5', '6'])
    expect(results[0].complete).toBe(true)
  })

  it('evaluates declarative formula targets and labels capped searches', () => {
    const echoes = [1, 2, 3, 4, 5, 6].map((value) => makeEcho(String(value), value))
    const formulaRequest: OptimizerRequest = {
      ...request(echoes), objective: 'expected', maxEvaluations: 10,
      formula: { target: { id: 'atk-target', label: 'ATK target', kind: 'stat', mode: 'expected' }, node: { op: 'stat', key: 'critRate' }, inputs: {}, entries: [] }
    }
    const results = optimizeBuilds(formulaRequest)
    expect(results[0].targetId).toBe('atk-target')
    expect(results[0].complete).toBe(false)
  })

  it('treats locked as inventory protection while honoring exclusions and constraints', () => {
    const echoes = [makeEcho('locked', 1, true), ...[2, 3, 4, 5, 6].map((value) => makeEcho(String(value), value)), { ...makeEcho('excluded', 100), excluded: true }]
    const results = optimizeBuilds({ ...request(echoes), minimumStats: { critRate: 40 } })
    expect(results[0].echoIds).not.toContain('locked')
    expect(results[0].echoIds).not.toContain('excluded')
  })

  it('deduplicates inventory IDs and allows protected high-cost Echoes to remain unequipped', () => {
    const duplicate = makeEcho('same', 10)
    const duplicateResults = optimizeBuilds(request([
      duplicate,
      { ...duplicate },
      ...[1, 2, 3, 4].map((value) => makeEcho(String(value), value))
    ]))
    expect(duplicateResults[0].echoIds.filter((id) => id === 'same')).toHaveLength(1)
    const protectedEchoes = [1, 2, 3, 4].map((value) => ({ ...makeEcho(String(value), value, true), cost: 4 as const }))
    expect(optimizeBuilds({ ...request([...protectedEchoes, ...[5, 6, 7, 8, 9].map((value) => makeEcho(String(value), value))]), limit: 1 })[0].echoIds).toEqual(['9', '8', '7', '6', '5'])
  })

  it('does not dominance-prune a weaker Echo needed by a maximum constraint', () => {
    const echoes = [1, 2, 3, 4, 5, 20].map((value) => makeEcho(String(value), value))
    const results = optimizeBuilds({ ...request(echoes), maximumStats: { critRate: 50 }, limit: 1 })
    expect(results[0].echoIds).not.toContain('20')
  })

  it('keeps the required main Echo in slot one', () => {
    const echoes = [1, 2, 3, 4, 5, 6].map((value) => makeEcho(String(value), value))
    const results = optimizeBuilds({ ...request(echoes), currentMainEchoId: '1', profile: profile() })
    expect(results[0].echoIds[0]).toBe('1')
    expect(results[0].mainEchoId).toBe('1')
  })

  it('partitions an exact search without changing the best result', () => {
    const echoes = [1, 2, 3, 4, 5, 6, 7].map((value) => makeEcho(String(value), value))
    const base = { ...request(echoes), currentMainEchoId: '1', profile: profile(), limit: 20 }
    const whole = optimizeBuildPartition(base)
    const partitions = [0, 1].flatMap((index) => optimizeBuildPartition({ ...base, partition: { index, count: 2 } }).results)
    expect(Math.max(...partitions.map((result) => result.score))).toBe(whole.results[0].score)
  })

  it('splits exact work into independently executable units without changing the result', () => {
    const echoes = [1, 2, 3, 4, 5, 6, 7, 8].map((value) => makeEcho(String(value), value))
    const base = { ...request(echoes), currentMainEchoId: '1', profile: profile(), limit: 20 }
    const plan = createOptimizerWorkPlan(base, 2)
    const outputs = plan.work.map((_, index) => optimizeOptimizerWorkUnit(plan, index))
    const best = outputs.flatMap((output) => output.results).sort((left, right) => right.score - left.score)[0]
    expect(outputs.reduce((total, output) => total + output.progress.total, 0)).toBe(plan.total)
    expect(best.score).toBe(optimizeBuildPartition(base).results[0].score)
  })

  it('proves and reports millions of impossible combinations without evaluating leaves', () => {
    const echoes = Array.from({ length: 40 }, (_, index) => makeEcho(String(index), 1))
    const output = optimizeBuildPartition({ ...request(echoes), minimumStats: { critRate: 10_000 }, limit: 1 })
    expect(output.progress.total).toBeGreaterThan(1_000_000)
    expect(output.progress.processed).toBe(output.progress.total)
    expect(output.progress.skippedBounds).toBe(output.progress.total)
    expect(output.progress.tested).toBe(0)
    expect(output.complete).toBe(true)
  })
})

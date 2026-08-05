import { bench, describe } from 'vitest'
import { createOptimizerWorkPlan, optimizeBuildPartition } from './optimizer'
import type { Echo, OptimizerProfile, OptimizerRequest, Resonator, Weapon } from './types'

const resonator: Resonator = {
  id: 'benchmark', name: 'Benchmark', element: 'fusion', role: 'DPS', accent: '#d86954',
  baseStats: { hp: 10_000, atk: 420, def: 1_000, critRate: 5, critDamage: 150 },
  attacks: [{ id: 'skill', name: 'Skill', type: 'skill', element: 'fusion', multiplier: 3.2, hits: 4, scalesWith: 'atk' }]
}
const weapon: Weapon = { id: 'benchmark-weapon', name: 'Benchmark weapon', type: 'rectifier', baseAtk: 500, stat: { key: 'critRate', value: 24.3 } }

function echo(index: number): Echo {
  const costs = [1, 1, 1, 3, 3, 4] as const
  const cost = costs[index % costs.length]
  const mainStat = cost === 4
    ? { key: index % 2 ? 'critRate' as const : 'critDamage' as const, value: index % 2 ? 22 : 44 }
    : cost === 3
      ? { key: index % 2 ? 'fusionDamage' as const : 'atkPercent' as const, value: 30 }
      : { key: 'atkPercent' as const, value: 18 }
  return {
    id: `bench-${index}`, name: `Benchmark Echo ${index}`, cost, rarity: 5, level: 25,
    sonata: index % 3 ? 'Molten Rift' : 'Lingering Tunes', mainStat,
    subStats: [
      { key: 'critRate', value: 6.3 + index % 5 },
      { key: 'critDamage', value: 12.6 + index % 7 },
      { key: 'atkPercent', value: 7.1 + index % 4 },
      { key: 'skillDamage', value: 6.4 + index % 6 },
      { key: 'atk', value: 30 + index % 20 }
    ],
    locked: index % 13 === 0, excluded: false, createdAt: index, source: 'manual'
  }
}

function profile(size: number, searchMode: OptimizerProfile['searchMode'], maxEvaluations: number): OptimizerProfile {
  return {
    id: `bench-${size}`, buildId: 'bench-build', levelLow: 0, levelHigh: 25, rarities: [5],
    mainStatsByCost: { '1': ['atkPercent'], '3': ['atkPercent', 'fusionDamage'], '4': ['critRate', 'critDamage'] },
    excludedEchoIds: [], equippedPolicy: 'all', teamBuildIds: [], mainEchoPolicy: 'current',
    selectedMainEchoId: undefined, allowedSonatas: ['Molten Rift', 'Lingering Tunes'], sonataMode: 'any',
    allowNoSonata: true, requiredSonataEffects: [], minimumStats: { critRate: 55 }, maximumStats: {},
    resultLimit: 10, plotStat: 'critRate', workerCount: 1, searchMode, maxEvaluations,
    allowPartial: false, updatedAt: 1
  }
}

export function optimizerBenchmarkRequest(
  size: 40 | 60 | 100 | 250 | 500,
  searchMode: OptimizerProfile['searchMode'] = 'fast',
  maxEvaluations = 100_000
): OptimizerRequest {
  const echoes = Array.from({ length: size }, (_, index) => echo(index))
  return {
    requestId: `benchmark-${size}`, echoes, resonator, weapon, attack: resonator.attacks[0],
    enemy: { level: 100, resistance: 10, damageReduction: 0 }, objective: 'expected',
    minimumStats: { critRate: 55 }, maximumStats: {}, limit: 10, maxEvaluations,
    currentMainEchoId: echoes[0].id, profile: profile(size, searchMode, maxEvaluations)
  }
}

describe('optimizer realistic inventory benchmark', () => {
  bench('compile and prune 500 Echo work plan', () => { createOptimizerWorkPlan(optimizerBenchmarkRequest(500)) }, { iterations: 1, warmupIterations: 0 })
  bench('60 Echo exact search', () => { optimizeBuildPartition(optimizerBenchmarkRequest(60, 'exact')) }, { iterations: 1, warmupIterations: 0 })
  for (const size of [100, 250, 500] as const) {
    bench(`${size} Echoes / 100k evaluation budget`, () => { optimizeBuildPartition(optimizerBenchmarkRequest(size)) }, { iterations: 1, warmupIterations: 0 })
  }
  bench('250 Echoes / 1m evaluation budget', () => { optimizeBuildPartition(optimizerBenchmarkRequest(250, 'fast', 1_000_000)) }, { iterations: 1, warmupIterations: 0 })
})

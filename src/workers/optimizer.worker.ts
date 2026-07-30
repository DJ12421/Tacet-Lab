/// <reference lib="webworker" />
import { optimizeBuilds } from '../domain/optimizer'
import type { OptimizerRequest } from '../domain/types'
import { calculateBuildAttackV2, enemyV2 } from '../domain/calculation-v2'

self.onmessage = (event: MessageEvent<OptimizerRequest>) => {
  try {
    const config = event.data.calculationV2
    const results = optimizeBuilds(event.data, event.data.maxEvaluations, config ? (echoes, stats) => {
      const sonataCounts = new Map<string, number>()
      for (const echo of echoes) sonataCounts.set(echo.sonata, (sonataCounts.get(echo.sonata) ?? 0) + 1)
      const result = calculateBuildAttackV2({
        build: { ...config.build, echoIds: echoes.map((echo) => echo.id) },
        character: config.character,
        characterCatalog: config.characterCatalog,
        weapon: config.weapon,
        weaponCatalog: config.weaponCatalog,
        scenario: config.scenario,
        partyEffects: config.partyEffects,
        roverGender: config.roverGender,
        showcase: {
          equipmentStats: stats,
          sonatas: [...sonataCounts].map(([name, count]) => ({ name, count })),
          echoSlots: echoes
        }
      }, config.attack, enemyV2(event.data.enemy, config.scenario))
      return result ? {
        attackId: result.attackId,
        normal: result.normal,
        critical: result.critical,
        expected: result.expected,
        hits: config.attack.count
      } : undefined
    } : undefined)
    self.postMessage({ requestId: event.data.requestId, results })
  } catch (error) {
    self.postMessage({ requestId: event.data.requestId, error: error instanceof Error ? error.message : 'Optimizer failed.' })
  }
}

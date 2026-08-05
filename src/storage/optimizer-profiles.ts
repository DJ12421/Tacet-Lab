import type { Echo, OptimizerProfile, OptimizerRun } from '../domain/types'
import { sonataCatalog } from '../game-data'
import { mainStatKeysByCost } from '../game-data/echo-main-stats'
import { db } from './database'

const profileId = (buildId: string) => `optimizer-${buildId}`

export function defaultOptimizerProfile(buildId: string): OptimizerProfile {
  return {
    id: profileId(buildId),
    buildId,
    levelLow: 0,
    levelHigh: 25,
    rarities: [1, 2, 3, 4, 5],
    mainStatsByCost: {
      '1': [...mainStatKeysByCost[1]],
      '3': [...mainStatKeysByCost[3]],
      '4': [...mainStatKeysByCost[4]]
    },
    excludedEchoIds: [],
    equippedPolicy: 'current',
    teamBuildIds: [],
    mainEchoPolicy: 'current',
    allowedSonatas: sonataCatalog.map((sonata) => sonata.name),
    sonataMode: 'any',
    allowNoSonata: true,
    requiredSonataEffects: [],
    minimumStats: {},
    maximumStats: {},
    resultLimit: 10,
    plotStat: 'atk',
    workerCount: 'auto',
    searchMode: 'exact',
    maxEvaluations: 5_000_000,
    allowPartial: false,
    updatedAt: Date.now()
  }
}

function normalizeProfile(buildId: string, stored?: OptimizerProfile): OptimizerProfile {
  const defaults = defaultOptimizerProfile(buildId)
  if (!stored) return defaults
  return {
    ...defaults,
    ...stored,
    id: profileId(buildId),
    buildId,
    rarities: stored.rarities?.filter((rarity) => [1, 2, 3, 4, 5].includes(rarity)) ?? defaults.rarities,
    mainStatsByCost: {
      '1': stored.mainStatsByCost?.['1'] ?? defaults.mainStatsByCost['1'],
      '3': stored.mainStatsByCost?.['3'] ?? defaults.mainStatsByCost['3'],
      '4': stored.mainStatsByCost?.['4'] ?? defaults.mainStatsByCost['4']
    },
    minimumStats: stored.minimumStats ?? {},
    maximumStats: stored.maximumStats ?? {},
    updatedAt: stored.updatedAt ?? Date.now()
  }
}

export async function loadOptimizerProfile(buildId: string): Promise<OptimizerProfile> {
  return normalizeProfile(buildId, await db.optimizerProfiles.get(profileId(buildId)))
}

export async function saveOptimizerProfile(profile: OptimizerProfile) {
  const normalized = normalizeProfile(profile.buildId, { ...profile, updatedAt: Date.now() })
  await db.optimizerProfiles.put(normalized)
  return normalized
}

export async function loadLatestOptimizerRun(buildId: string): Promise<OptimizerRun | undefined> {
  const runs = await db.optimizerRuns.where('buildId').equals(buildId).toArray()
  return runs.sort((left, right) => right.createdAt - left.createdAt)[0]
}

export async function saveOptimizerRun(run: OptimizerRun) {
  await db.transaction('rw', db.optimizerRuns, async () => {
    await db.optimizerRuns.put(run)
    const runs = (await db.optimizerRuns.where('buildId').equals(run.buildId).toArray()).sort((left, right) => right.createdAt - left.createdAt)
    const stale = runs.slice(5)
    if (stale.length) await db.optimizerRuns.bulkDelete(stale.map((entry) => entry.id))
  })
}

export async function updateOptimizerRunHighlights(runId: string, highlightedBuildKeys: string[]) {
  await db.optimizerRuns.update(runId, { highlightedBuildKeys })
}

function fingerprint(source: string) {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function optimizerProfileFingerprint(profile: OptimizerProfile) {
  const { updatedAt: _, plotStat: __, ...searchConfiguration } = profile
  return fingerprint(JSON.stringify(searchConfiguration))
}

export function optimizerContextFingerprint(context: unknown) {
  return fingerprint(JSON.stringify(context))
}

export function optimizerInventoryFingerprint(echoes: Echo[]) {
  const source = [...echoes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((echo) => `${echo.id}:${echo.level}:${echo.rarity}:${echo.sonata}:${echo.mainStat.key}:${echo.mainStat.value}:${echo.subStats.map((stat) => `${stat.key}:${stat.value}`).join(',')}:${echo.locked ? 1 : 0}:${echo.excluded ? 1 : 0}:${echo.equippedBy ?? ''}`)
    .join('|')
  return fingerprint(source)
}

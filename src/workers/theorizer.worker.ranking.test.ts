import { expect, it, vi } from 'vitest'
import { characterCatalog, weaponCatalog } from '../game-data'
import type { OwnedCharacter, Team, TheorycraftBuild } from '../domain/types'
import { YANGYANG } from '../domain/combat/stateful/resonators/aero/yangyang.js'
import { TEAM_ROTATION_TARGET_ID } from '../ui/team-workspace-model'
import type { TheorizerRankingRequest, TheorizerRankingResponse } from './theorizer.worker'

it('uses one scoring method across a complete Theorizer candidate set', async () => {
  const postMessage = vi.fn()
  const workerSelf: { postMessage: typeof postMessage; onmessage?: (event: MessageEvent<TheorizerRankingRequest>) => void } = { postMessage }
  vi.stubGlobal('self', workerSelf)
  try {
    await import('./theorizer.worker')
    const catalog = characterCatalog.find((entry) => entry.id === '1402')!
    const weapon = weaponCatalog.find((entry) => entry.name === YANGYANG.refinements[0]![0]!.name.replace(/ R\d$/, ''))!
    const character: OwnedCharacter = { id: 'character', catalogId: catalog.id, level: 90, sequence: 0,
      skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 0 }
    const baseline: TheorycraftBuild = { id: 'baseline', name: 'Baseline', description: '', characterId: character.id,
      weapon: { catalogId: weapon.id, level: 90, rank: 1 }, mainEchoName: YANGYANG.echoLoadouts[0]!.mainslot.name,
      slots: ([4, 3, 3, 1, 1] as const).map((cost) => ({ cost, rarity: 5, level: 25, mainStatKey: cost === 4 ? 'critRate' : 'atkPercent' })),
      sonatas: [{ name: YANGYANG.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, ''), pieces: 5 }],
      substats: { mode: 'slots', slots: [[], [], [], [], []] }, createdAt: 0, updatedAt: 0 }
    const team: Team = { id: 'team', name: 'Fixture', members: [{ memberId: 'member', characterId: character.id,
      loadoutSource: { type: 'theorycraft', theorycraftBuildId: baseline.id } }], buildIds: [],
      enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 1,
      actions: [{ id: 'cast', timestamp: 0, buildId: 'member', attackId: '1402-1-0' }] }
    const request: TheorizerRankingRequest = { requestId: 1, mode: 'substats', baseline, memberSlot: 0,
      targetId: TEAM_ROTATION_TARGET_ID, resultMode: 'expected', scalesWith: 'atk', element: 'Aero',
      team, builds: [], characters: [character], weapons: [], echoes: [] }
    workerSelf.onmessage!(new MessageEvent('message', { data: request }))
    const response = postMessage.mock.calls[0]?.[0] as TheorizerRankingResponse
    expect(response.calculationMethod).toBe('stateful')
    expect(response.baselineScore).toBeGreaterThan(0)
    expect(response.results.length).toBeGreaterThan(0)
    expect(response.results.every((entry) => Number.isFinite(entry.score))).toBe(true)
    expect(response.results.every((entry) => !entry.id.includes(':remove:'))).toBe(true)
    workerSelf.onmessage!(new MessageEvent('message', { data: { ...request, requestId: 2, mode: 'weapons', weaponType: catalog.weaponType } }))
    const mixedCoverage = postMessage.mock.calls[1]?.[0] as TheorizerRankingResponse
    expect(mixedCoverage.calculationMethod).toBe('formula')
    expect(mixedCoverage.results.length).toBeGreaterThan(0)
  } finally {
    vi.unstubAllGlobals()
  }
}, 15_000)

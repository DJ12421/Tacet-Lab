/// <reference lib="webworker" />
import {
  calculateBuildStatsV2,
  calculatePreparedBuildAttackV2,
  emptyCalculationScenarioV2,
  enemyV2,
  prepareBuildAttackV2,
  resolveCharacterMechanicsV2,
  resolveEchoMechanicsV2,
  resolveSonataMechanicsV2,
  type CalculationEffectDefinition,
  type CalculationSourceStats,
  type CalculationStatsV2,
  type PreparedBuildAttackV2
} from '../domain/calculation-v2'
import { isSonataAvailableToCharacter, resolveLoadout, theorycraftRollValue, theorycraftSonataPlanKey, theorycraftSubstatLines } from '../domain/loadouts'
import type { Echo, StatKey, TheorycraftBuild } from '../domain/types'
import { characterCatalog, echoCatalog, sonataCatalog, statLabels, weaponCatalog } from '../game-data'
import { mainStatKeysByCost } from '../game-data/echo-main-stats'
import { tunableRolls } from '../game-data/tunable-rolls'
import { resolveCharacterShowcaseModel } from '../ui/character-showcase-model'
import {
  resolvedOutgoingPartyEffects,
  resolveTeamWorkspace,
  type TeamMemberModel,
  type TeamWorkspaceInput,
  type TeamWorkspaceModel
} from '../ui/team-workspace-model'

export type TheorizerMode = 'mainStats' | 'substats' | 'sonatas' | 'weapons'

export type TheorizerRankingRequest = TeamWorkspaceInput & {
  requestId: number
  mode: TheorizerMode
  baseline: TheorycraftBuild
  memberSlot: number
  targetId: string
  resultMode: 'normal' | 'critical' | 'expected'
  scalesWith: 'atk' | 'hp' | 'def'
  element: string
  weaponType?: string
  substatDraft?: TheorycraftBuild
}

export interface TheorizerRankingEntry {
  id: string
  rank?: number
  label: string
  detail: string
  image?: string
  draft: TheorycraftBuild
  score: number
  delta: number
  candidateStats?: CalculationStatsV2
}

export type TheorizerRankingResponse = {
  requestId: number
  baselineScore: number
  baselineStats?: CalculationStatsV2
  results: TheorizerRankingEntry[]
}

type DraftSuggestion = Omit<TheorizerRankingEntry, 'score' | 'delta' | 'candidateStats'>
type MainStatChoice = { cost: Echo['cost']; key: StatKey }
const unique = <T,>(values: T[]) => [...new Set(values)]
const clone = <T,>(value: T): T => structuredClone(value)

function validCostLayouts() {
  const layouts: Echo['cost'][][] = []
  const costs: Echo['cost'][] = [4, 3, 1]
  const current: Echo['cost'][] = []
  const visit = (startIndex: number, totalCost: number) => {
    if (current.length === 5) {
      layouts.push([...current])
      return
    }
    for (let index = startIndex; index < costs.length; index += 1) {
      const cost = costs[index]
      if (totalCost + cost > 12) continue
      current.push(cost)
      visit(index, totalCost + cost)
      current.pop()
    }
  }
  visit(0, 0)
  return layouts
}

function mainStatSuggestions(input: TheorizerRankingRequest): DraftSuggestion[] {
  const scalingKey = `${input.scalesWith}Percent` as StatKey
  const elementKey = `${input.element.toLowerCase()}Damage` as StatKey
  return validCostLayouts().flatMap((costs) => {
    const options = costs.map((cost, index) => unique<StatKey>([
      input.baseline.slots[index].mainStatKey,
      ...(cost === 4 ? ['critRate', 'critDamage', scalingKey] as StatKey[] : []),
      ...(cost === 3 ? [elementKey, 'energyRegen', scalingKey] as StatKey[] : []),
      ...(cost === 1 ? [scalingKey] : [])
    ]).filter((key) => mainStatKeysByCost[cost].includes(key)))
    return options.reduce<MainStatChoice[][]>((plans, slotOptions, index) => plans.flatMap((plan) => slotOptions.map((key) => [...plan, { cost: costs[index], key }])), [[]])
  }).flatMap((plan) => {
    if (plan.every((choice, index) => choice.cost === input.baseline.slots[index].cost && choice.key === input.baseline.slots[index].mainStatKey)) return []
    const draft: TheorycraftBuild = {
      ...clone(input.baseline),
      id: `preview:main:${plan.map((choice) => `${choice.cost}-${choice.key}`).join('|')}`,
      slots: input.baseline.slots.map((slot, index) => ({ ...slot, cost: plan[index].cost, mainStatKey: plan[index].key })),
      substats: input.baseline.substats.mode === 'slots'
        ? { mode: 'slots', slots: input.baseline.substats.slots.map((lines, index) => lines.filter((line) => line.key !== plan[index].key)) }
        : clone(input.baseline.substats)
    }
    return [{ id: draft.id, label: plan.map((choice) => statLabels[choice.key]).join(' / '), detail: 'Complete five-Echo main-stat plan', draft }]
  })
}

function weaponSuggestions(input: TheorizerRankingRequest): DraftSuggestion[] {
  return weaponCatalog.filter((weapon) => weapon.type.toLowerCase() === input.weaponType?.toLowerCase()).flatMap((weapon) => {
    if (weapon.id === input.baseline.weapon.catalogId && input.baseline.weapon.level === 90 && input.baseline.weapon.rank === 1) return []
    const draft = { ...clone(input.baseline), id: `preview:weapon:${weapon.id}`, weapon: { catalogId: weapon.id, level: 90, rank: 1 } }
    return [{ id: draft.id, label: weapon.name, detail: `R1 · Lv. 90 · ${weapon.secondaryStat}`, image: weapon.iconSourceUrl, draft }]
  })
}

function sonataSuggestions(input: TheorizerRankingRequest): DraftSuggestion[] {
  const currentMainEcho = echoCatalog.find((echo) => echo.name === input.baseline.mainEchoName)
  const characterCatalogId = input.characters.find((character) => character.id === input.baseline.characterId)?.catalogId
  const availableSonatas = sonataCatalog.filter((sonata) => isSonataAvailableToCharacter(sonata.name, characterCatalogId))
  const plans: Array<Array<{ name: string; pieces: number }>> = []
  const visit = (startIndex: number, remaining: number, plan: Array<{ name: string; pieces: number }>) => {
    if (!remaining) {
      plans.push(plan)
      return
    }
    for (let index = startIndex; index < availableSonatas.length; index += 1) {
      const sonata = availableSonatas[index]
      const thresholds = sonata.effects.map((effect) => effect.pieces)
      const minimum = Math.min(...thresholds)
      const maximum = Math.min(remaining, Math.max(...thresholds))
      for (let pieces = minimum; pieces <= maximum; pieces += 1) {
        visit(index + 1, remaining - pieces, [...plan, { name: sonata.name, pieces }])
      }
    }
  }
  visit(0, 5, [])
  const suggestions = plans.flatMap((plan) => {
    if (currentMainEcho && !plan.some((entry) => currentMainEcho.sonatas.includes(entry.name))) return []
    const ordered = currentMainEcho ? [...plan].sort((left, right) => Number(currentMainEcho.sonatas.includes(right.name)) - Number(currentMainEcho.sonatas.includes(left.name))) : plan
    const key = ordered.map((entry) => `${entry.pieces}-${entry.name}`).join('|')
    if (theorycraftSonataPlanKey(ordered) === theorycraftSonataPlanKey(input.baseline.sonatas)) return []
    const draft = { ...clone(input.baseline), id: `preview:sonata:${key}`, sonatas: ordered }
    return [{ id: draft.id, label: ordered.map((entry) => `${entry.pieces}pc ${entry.name}`).join(' + '), detail: 'Complete five-Echo Sonata plan', draft }]
  })
  return [...new Map(suggestions.map((suggestion) => [theorycraftSonataPlanKey(suggestion.draft.sonatas), suggestion])).values()]
}

function substatSuggestions(input: TheorizerRankingRequest): DraftSuggestion[] {
  const totals = Object.fromEntries(theorycraftSubstatLines(input.baseline).map((line) => [line.key, line.value])) as Partial<Record<StatKey, number>>
  return (Object.keys(tunableRolls) as StatKey[]).flatMap((key) => {
    const step = theorycraftRollValue(key, 1, 'mid')
    return ([['add', 1], ['remove', -1]] as const).map(([direction, multiplier]) => {
      const draft: TheorycraftBuild = {
        ...clone(input.baseline),
        id: `preview:substat:${direction}:${key}`,
        substats: { mode: 'values', values: { ...totals, [key]: (totals[key] ?? 0) + step * multiplier } }
      }
      return { id: draft.id, label: statLabels[key], detail: `${multiplier > 0 ? '+' : '−'}${step} ${statLabels[key]}`, draft }
    })
  })
}

function suggestionsFor(input: TheorizerRankingRequest) {
  if (input.mode === 'mainStats') return mainStatSuggestions(input)
  if (input.mode === 'weapons') return weaponSuggestions(input)
  if (input.mode === 'sonatas') return sonataSuggestions(input)
  return substatSuggestions(input)
}

function materializeCandidate(input: TheorizerRankingRequest, draft: TheorycraftBuild, baselineMember: TeamMemberModel) {
  if (!baselineMember.build) return undefined
  const resolved = resolveLoadout({ type: 'theorycraft', theorycraftBuildId: draft.id }, {
    builds: input.builds,
    characters: input.characters,
    weapons: input.weapons,
    echoes: input.echoes,
    equippedLoadouts: input.equippedLoadouts ?? [],
    theorycraftBuilds: [...(input.theorycraftBuilds ?? []), draft]
  }, baselineMember.build.id)
  if (!resolved.build || !resolved.character) return undefined
  const catalog = characterCatalog.find((entry) => entry.id === resolved.build?.resonatorId)
  if (!catalog) return undefined
  const runtimeWeapons = resolved.weapon ? [...input.weapons, resolved.weapon] : input.weapons
  const runtimeEchoes = [...input.echoes, ...resolved.echoes]
  const showcase = resolveCharacterShowcaseModel({
    character: resolved.character,
    catalog,
    weapons: runtimeWeapons,
    echoes: runtimeEchoes,
    builds: [resolved.build]
  })
  if (!showcase) return undefined
  const characterMechanics = resolveCharacterMechanicsV2(catalog, resolved.character, input.roverGender)
  if (!characterMechanics) return undefined
  const mainEchoMechanics = resolveEchoMechanicsV2(showcase.echoSlots[0])
  const calculationMechanics = {
    ...characterMechanics,
    attacks: [...characterMechanics.attacks, ...(mainEchoMechanics?.attacks ?? [])]
  }
  return {
    ...baselineMember,
    build: resolved.build,
    character: resolved.character,
    catalog,
    showcase,
    resolvedEchoes: resolved.echoes,
    resolvedWeapon: resolved.weapon,
    calculationMechanicsV2: calculationMechanics,
    mainEchoMechanicsV2: mainEchoMechanics
  } satisfies TeamMemberModel
}

function baseSourceStats(model: TeamWorkspaceModel, input: TheorizerRankingRequest): CalculationSourceStats {
  const result: CalculationSourceStats = {}
  for (const member of model.members) {
    if (!member.build || !member.character || !member.catalog || !member.showcase) continue
    const stats = calculateBuildStatsV2({
      build: member.build,
      character: member.character,
      characterCatalog: member.catalog,
      weapon: member.showcase.weapon?.owned,
      weaponCatalog: member.showcase.weapon?.catalog,
      showcase: member.showcase,
      scenario: input.team.calculationV2,
      activeCustomBuffs: member.receivedBuffs,
      includeMainEchoEffects: !(member.slot === input.memberSlot && (input.mode === 'mainStats' || input.mode === 'sonatas')),
      roverGender: input.roverGender
    })
    if (stats) result[member.build.id] = stats
  }
  return result
}

type FastDirectContext = {
  baselineMember: TeamMemberModel
  baseSources: CalculationSourceStats
  resolvedSources: CalculationSourceStats
  fixedPartyEffects: CalculationEffectDefinition[]
  prepared: Map<string, PreparedBuildAttackV2 | null>
}

function evaluateDirectCandidate(input: TheorizerRankingRequest, draft: TheorycraftBuild, context: FastDirectContext) {
  const member = materializeCandidate(input, draft, context.baselineMember)
  if (!member?.build || !member.character || !member.catalog || !member.showcase || !member.calculationMechanicsV2) return undefined
  const attack = member.calculationMechanicsV2.attacks.find((entry) => entry.id === input.targetId)
  if (!attack) return { score: 0, candidateStats: undefined }
  const includeMainEchoEffects = input.mode !== 'mainStats' && input.mode !== 'sonatas'
  const ownPartyEffects = resolvedOutgoingPartyEffects(member, includeMainEchoEffects)
    .filter((effect) => effect.scope === 'team' || effect.scope === 'enemy')
  const partyEffects = [...context.fixedPartyEffects, ...ownPartyEffects]
  const sonataEffects = member.showcase.sonatas.flatMap((sonata) => resolveSonataMechanicsV2(sonata.name, sonata.count, member.catalog.id)).flatMap((sonata) => sonata.effects)
  const sonataSelections = Object.fromEntries(sonataEffects.map((effect) => [effect.id, {
    enabled: true,
    ...(effect.hasStacks ? { stacks: effect.maxStacks } : {})
  }]))
  const sonataEffectIds = new Set(sonataEffects.map((effect) => effect.id))
  const sonataPartySelections: typeof sonataSelections = {}
  for (const effect of ownPartyEffects) {
    if (effect.definitionId && sonataEffectIds.has(effect.definitionId)) sonataPartySelections[effect.id] = sonataSelections[effect.definitionId]
  }
  const baseScenario = input.team.calculationV2 ?? emptyCalculationScenarioV2()
  const scenario = {
    ...baseScenario,
    memberEffects: {
      ...baseScenario.memberEffects,
      [member.build.id]: { ...baseScenario.memberEffects[member.build.id], ...sonataSelections }
    },
    partyEffects: {
      ...baseScenario.partyEffects,
      [member.build.id]: { ...baseScenario.partyEffects[member.build.id], ...sonataPartySelections }
    }
  }
  const source = {
    build: member.build,
    character: member.character,
    characterCatalog: member.catalog,
    weapon: member.showcase.weapon?.owned,
    weaponCatalog: member.showcase.weapon?.catalog,
    showcase: member.showcase,
    scenario,
    partyEffects,
    activeCustomBuffs: member.receivedBuffs,
    includeMainEchoEffects,
    roverGender: input.roverGender
  }
  const candidateBase = calculateBuildStatsV2(source)
  if (!candidateBase) return undefined
  const baseSources = { ...context.baseSources, [member.build.id]: candidateBase }
  const candidateStats = calculateBuildStatsV2({ ...source, sourceStats: baseSources })
  if (!candidateStats) return undefined
  const sourceStats = { ...context.resolvedSources, [member.build.id]: candidateStats }
  const signature = [
    member.showcase.weapon?.catalog.id ?? '',
    member.showcase.weapon?.owned.rank ?? 1,
    member.showcase.sonatas.map((entry) => `${entry.name}:${entry.count}`).sort().join('|'),
    includeMainEchoEffects ? member.showcase.echoSlots[0]?.name ?? '' : 'neutral-main',
    attack.id
  ].join('::')
  let prepared = context.prepared.get(signature)
  if (prepared === undefined) {
    prepared = prepareBuildAttackV2({ ...source, sourceStats }, attack, enemyV2(input.team.enemy, input.team.calculationV2)) ?? null
    context.prepared.set(signature, prepared)
  }
  if (!prepared) return undefined
  const result = calculatePreparedBuildAttackV2({ ...prepared, sourceStats }, member.showcase.equipmentStats)
  return { score: result[input.resultMode], candidateStats }
}

function scoreFor(input: TheorizerRankingRequest, member: ReturnType<typeof resolveTeamWorkspace>['members'][number]) {
  return member.calculationRowsV2.find((row) => row.attack.id === input.targetId)?.result[input.resultMode] ?? 0
}

function insertTopNine(results: TheorizerRankingEntry[], entry: TheorizerRankingEntry) {
  const index = results.findIndex((candidate) => entry.score > candidate.score)
  if (index >= 0) results.splice(index, 0, entry)
  else if (results.length < 9) results.push(entry)
  if (results.length > 9) results.length = 9
}

self.onmessage = (event: MessageEvent<TheorizerRankingRequest>) => {
  const input = event.data
  const neutralMainEchoSlots = input.mode === 'mainStats' || input.mode === 'sonatas' ? [input.memberSlot] : undefined
  const focusedAttack = { slot: input.memberSlot, attackId: input.targetId }
  const baseMembers = input.team.members ?? []
  const baselineMembers = [...baseMembers]
  const baselineRecord = baselineMembers[input.memberSlot]
  if (!baselineRecord) return
  baselineMembers[input.memberSlot] = { ...baselineRecord, loadoutSource: { type: 'theorycraft', theorycraftBuildId: input.baseline.id } }
  const resolverInput = { ...input, neutralMainEchoSlots, focusedAttack }
  const baselineModel = resolveTeamWorkspace({
    ...resolverInput,
    team: { ...input.team, members: baselineMembers },
    theorycraftBuilds: [...(input.theorycraftBuilds ?? []), input.baseline]
  })
  const baselineMember = baselineModel.members[input.memberSlot]
  const baseTheorycraftBuilds = input.theorycraftBuilds ?? []
  const directContext: FastDirectContext | undefined = !baselineMember.build
    ? undefined
    : {
        baselineMember,
        baseSources: baseSourceStats(baselineModel, input),
        resolvedSources: baselineModel.sourceStatsV2,
        fixedPartyEffects: baselineMember.calculationEffectsV2.filter((effect) => effect.sourceKind === 'party' && effect.sourceBuildId !== baselineMember.build!.id),
        prepared: new Map()
      }
  const evaluatedBaseline = directContext ? evaluateDirectCandidate(input, input.baseline, directContext) : undefined
  const baselineScore = evaluatedBaseline?.score ?? scoreFor(input, baselineMember)
  const baselineStats = evaluatedBaseline?.candidateStats ?? baselineMember.resolvedStatsV2
  const results: TheorizerRankingEntry[] = []
  let betterThanBaseline = 0

  for (const suggestion of suggestionsFor(input)) {
    const fast = directContext ? evaluateDirectCandidate(input, suggestion.draft, directContext) : undefined
    if (fast) {
      if (fast.score > baselineScore) betterThanBaseline += 1
      const entry = { ...suggestion, score: fast.score, delta: fast.score - baselineScore, candidateStats: fast.candidateStats }
      if (input.mode === 'substats') results.push(entry)
      else insertTopNine(results, entry)
      continue
    }
    const members = [...baseMembers]
    const record = members[input.memberSlot]
    if (!record) continue
    members[input.memberSlot] = { ...record, loadoutSource: { type: 'theorycraft', theorycraftBuildId: suggestion.draft.id } }
    const resolved = resolveTeamWorkspace({ ...resolverInput, team: { ...input.team, members }, theorycraftBuilds: [...baseTheorycraftBuilds, suggestion.draft] })
    const candidateMember = resolved.members[input.memberSlot]
    const score = scoreFor(input, candidateMember)
    if (score > baselineScore) betterThanBaseline += 1
    const entry = { ...suggestion, score, delta: score - baselineScore, candidateStats: candidateMember.resolvedStatsV2 }
    if (input.mode === 'substats') results.push(entry)
    else insertTopNine(results, entry)
  }

  if (input.mode === 'substats') results.sort((left, right) => right.delta - left.delta)

  const weapon = weaponCatalog.find((entry) => entry.id === input.baseline.weapon.catalogId)
  const baselineRank = betterThanBaseline + 1
  const baselineEntry: TheorizerRankingEntry = {
    id: `${input.mode}:baseline`,
    rank: baselineRank,
    label: input.mode === 'mainStats' ? input.baseline.slots.map((slot) => statLabels[slot.mainStatKey]).join(' / ') : 'Current equipped build',
    detail: 'Current equipped option (base)',
    image: input.mode === 'weapons' ? weapon?.iconSourceUrl : undefined,
    draft: input.baseline,
    score: baselineScore,
    delta: 0,
    candidateStats: baselineStats
  }
  if (baselineRank <= 10) results.splice(Math.min(baselineRank - 1, results.length), 0, baselineEntry)
  else results.push(baselineEntry)

  const response: TheorizerRankingResponse = { requestId: input.requestId, baselineScore, baselineStats, results }
  self.postMessage(response)
}

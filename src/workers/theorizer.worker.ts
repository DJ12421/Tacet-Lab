/// <reference lib="webworker" />
import { isSonataAvailableToCharacter, theorycraftRollValue, theorycraftSonataPlanKey, theorycraftSubstatLines } from '../domain/loadouts'
import type { AggregatedStats, Echo, StatKey, TheorycraftBuild } from '../domain/types'
import { echoCatalog, sonataCatalog, statLabels, weaponCatalog } from '../game-data'
import { mainStatKeysByCost } from '../game-data/echo-main-stats'
import { tunableRolls } from '../game-data/tunable-rolls'
import { resolveTeamWorkspace, type TeamWorkspaceInput } from '../ui/team-workspace-model'

export type TheorizerMode = 'mainStats' | 'substats' | 'sonatas' | 'weapons'
export type TheorizerRankingRequest = TeamWorkspaceInput & { requestId: number; mode: TheorizerMode; baseline: TheorycraftBuild; memberSlot: number; targetId: string; resultMode: 'normal' | 'critical' | 'expected'; scalesWith: 'atk' | 'hp' | 'def'; element: string; weaponType?: string; substatDraft?: TheorycraftBuild }
export interface TheorizerComparisonStats { hp: number; atk: number; def: number; critRate: number; critDamage: number; energyRegen: number; healingBonus: number; typeDamage: Record<'basic' | 'heavy' | 'skill' | 'liberation', number>; elementalDamage: Record<'spectro' | 'fusion' | 'glacio' | 'electro' | 'aero' | 'havoc', number> }
export interface TheorizerRankingEntry { id: string; rank?: number; label: string; detail: string; image?: string; draft: TheorycraftBuild; score: number; delta: number; candidateStats?: TheorizerComparisonStats }
export type TheorizerRankingResponse = { requestId: number; baselineScore: number; baselineStats?: TheorizerComparisonStats; results: TheorizerRankingEntry[] }
type DraftSuggestion = Omit<TheorizerRankingEntry, 'score' | 'delta' | 'candidateStats'>
type MainStatChoice = { cost: Echo['cost']; key: StatKey }
const unique = <T,>(values: T[]) => [...new Set(values)]
const clone = <T,>(value: T): T => structuredClone(value)

function validCostLayouts() {
  const layouts: Echo['cost'][][] = [], costs: Echo['cost'][] = [4, 3, 1], current: Echo['cost'][] = []
  const visit = (startIndex: number, totalCost: number) => {
    if (current.length === 5) { layouts.push([...current]); return }
    for (let index = startIndex; index < costs.length; index += 1) { const cost = costs[index]; if (totalCost + cost > 12) continue; current.push(cost); visit(index, totalCost + cost); current.pop() }
  }
  visit(0, 0)
  return layouts
}

function mainStatSuggestions(input: TheorizerRankingRequest): DraftSuggestion[] {
  const scalingKey = `${input.scalesWith}Percent` as StatKey, elementKey = `${input.element.toLowerCase()}Damage` as StatKey
  return validCostLayouts().flatMap((costs) => {
    const options = costs.map((cost, index) => unique<StatKey>([input.baseline.slots[index].mainStatKey, ...(cost === 4 ? ['critRate', 'critDamage', scalingKey] as StatKey[] : []), ...(cost === 3 ? [elementKey, 'energyRegen', scalingKey] as StatKey[] : []), ...(cost === 1 ? [scalingKey] : [])]).filter((key) => mainStatKeysByCost[cost].includes(key)))
    return options.reduce<MainStatChoice[][]>((plans, slotOptions, index) => plans.flatMap((plan) => slotOptions.map((key) => [...plan, { cost: costs[index], key }])), [[]])
  }).flatMap((plan) => {
    if (plan.every((choice, index) => choice.cost === input.baseline.slots[index].cost && choice.key === input.baseline.slots[index].mainStatKey)) return []
    const draft: TheorycraftBuild = { ...clone(input.baseline), id: `preview:main:${plan.map((choice) => `${choice.cost}-${choice.key}`).join('|')}`, slots: input.baseline.slots.map((slot, index) => ({ ...slot, cost: plan[index].cost, mainStatKey: plan[index].key })), substats: input.baseline.substats.mode === 'slots' ? { mode: 'slots', slots: input.baseline.substats.slots.map((lines, index) => lines.filter((line) => line.key !== plan[index].key)) } : clone(input.baseline.substats) }
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
  const mainEcho = echoCatalog.find((echo) => echo.name === input.baseline.mainEchoName)
  const characterId = input.characters.find((character) => character.id === input.baseline.characterId)?.catalogId
  const available = sonataCatalog.filter((sonata) => isSonataAvailableToCharacter(sonata.name, characterId))
  const plans: Array<Array<{ name: string; pieces: number }>> = []
  const visit = (start: number, remaining: number, plan: Array<{ name: string; pieces: number }>) => {
    if (!remaining) { plans.push(plan); return }
    for (let index = start; index < available.length; index += 1) { const thresholds = available[index].effects.map((effect) => effect.pieces); for (let pieces = Math.min(...thresholds); pieces <= Math.min(remaining, Math.max(...thresholds)); pieces += 1) visit(index + 1, remaining - pieces, [...plan, { name: available[index].name, pieces }]) }
  }
  visit(0, 5, [])
  const suggestions = plans.flatMap((plan) => {
    if (mainEcho && !plan.some((entry) => mainEcho.sonatas.includes(entry.name))) return []
    const ordered = mainEcho ? [...plan].sort((left, right) => Number(mainEcho.sonatas.includes(right.name)) - Number(mainEcho.sonatas.includes(left.name))) : plan
    if (theorycraftSonataPlanKey(ordered) === theorycraftSonataPlanKey(input.baseline.sonatas)) return []
    const draft = { ...clone(input.baseline), id: `preview:sonata:${theorycraftSonataPlanKey(ordered)}`, sonatas: ordered }
    return [{ id: draft.id, label: ordered.map((entry) => `${entry.pieces}pc ${entry.name}`).join(' + '), detail: 'Complete five-Echo Sonata plan', draft }]
  })
  return [...new Map(suggestions.map((suggestion) => [theorycraftSonataPlanKey(suggestion.draft.sonatas), suggestion])).values()]
}

function substatSuggestions(input: TheorizerRankingRequest): DraftSuggestion[] {
  const totals = Object.fromEntries(theorycraftSubstatLines(input.baseline).map((line) => [line.key, line.value])) as Partial<Record<StatKey, number>>
  return (Object.keys(tunableRolls) as StatKey[]).flatMap((key) => { const step = theorycraftRollValue(key, 1, 'mid'); return ([['add', 1], ['remove', -1]] as const).map(([direction, multiplier]) => { const draft: TheorycraftBuild = { ...clone(input.baseline), id: `preview:substat:${direction}:${key}`, substats: { mode: 'values', values: { ...totals, [key]: (totals[key] ?? 0) + step * multiplier } } }; return { id: draft.id, label: statLabels[key], detail: `${multiplier > 0 ? '+' : '−'}${step} ${statLabels[key]}`, draft } }) })
}

function suggestionsFor(input: TheorizerRankingRequest) { return input.mode === 'mainStats' ? mainStatSuggestions(input) : input.mode === 'weapons' ? weaponSuggestions(input) : input.mode === 'sonatas' ? sonataSuggestions(input) : substatSuggestions(input) }

function comparisonStats(stats: AggregatedStats | undefined): TheorizerComparisonStats | undefined {
  if (!stats) return undefined
  return { hp: stats.hp, atk: stats.atk, def: stats.def, critRate: stats.critRate, critDamage: stats.critDamage, energyRegen: stats.energyRegen, healingBonus: stats.healingBonus, typeDamage: { basic: stats.basicDamage, heavy: stats.heavyDamage, skill: stats.skillDamage, liberation: stats.liberationDamage }, elementalDamage: { spectro: stats.spectroDamage, fusion: stats.fusionDamage, glacio: stats.glacioDamage, electro: stats.electroDamage, aero: stats.aeroDamage, havoc: stats.havocDamage } }
}

function resolveCandidate(input: TheorizerRankingRequest, draft: TheorycraftBuild) {
  const members = [...(input.team.members ?? [])], record = members[input.memberSlot]
  if (!record) return undefined
  members[input.memberSlot] = { ...record, loadoutSource: { type: 'theorycraft', theorycraftBuildId: draft.id } }
  const model = resolveTeamWorkspace({ ...input, team: { ...input.team, members }, theorycraftBuilds: [...(input.theorycraftBuilds ?? []), draft] })
  const member = model.members[input.memberSlot]
  return { score: member.formulaRows.find((row) => row.target.id === input.targetId)?.[input.resultMode] ?? 0, stats: comparisonStats(member.conditionedStats) }
}

function insertTopNine(results: TheorizerRankingEntry[], entry: TheorizerRankingEntry) { const index = results.findIndex((candidate) => entry.score > candidate.score); if (index >= 0) results.splice(index, 0, entry); else if (results.length < 9) results.push(entry); if (results.length > 9) results.length = 9 }

self.onmessage = (event: MessageEvent<TheorizerRankingRequest>) => {
  const input = event.data, baseline = resolveCandidate(input, input.baseline), baselineScore = baseline?.score ?? 0
  const results: TheorizerRankingEntry[] = []
  let betterThanBaseline = 0
  for (const suggestion of suggestionsFor(input)) { const candidate = resolveCandidate(input, suggestion.draft); if (!candidate) continue; if (candidate.score > baselineScore) betterThanBaseline += 1; const entry = { ...suggestion, score: candidate.score, delta: candidate.score - baselineScore, candidateStats: candidate.stats }; if (input.mode === 'substats') results.push(entry); else insertTopNine(results, entry) }
  if (input.mode === 'substats') results.sort((left, right) => right.delta - left.delta)
  const baselineRank = betterThanBaseline + 1, weapon = weaponCatalog.find((entry) => entry.id === input.baseline.weapon.catalogId)
  const baselineEntry: TheorizerRankingEntry = { id: `${input.mode}:baseline`, rank: baselineRank, label: input.mode === 'mainStats' ? input.baseline.slots.map((slot) => statLabels[slot.mainStatKey]).join(' / ') : 'Current equipped build', detail: 'Current equipped option (base)', image: input.mode === 'weapons' ? weapon?.iconSourceUrl : undefined, draft: input.baseline, score: baselineScore, delta: 0, candidateStats: baseline?.stats }
  if (baselineRank <= 10) results.splice(Math.min(baselineRank - 1, results.length), 0, baselineEntry); else results.push(baselineEntry)
  self.postMessage({ requestId: input.requestId, baselineScore, baselineStats: baseline?.stats, results } satisfies TheorizerRankingResponse)
}

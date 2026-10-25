import type { ActionFormula, CharacterActionMechanics, DamageType, Element, ScalingStat } from '../../domain/combat'
import { generatedCharacterCatalog } from '../characters.generated'
import { isFixedSkillValueName } from '../attack-values'
import source from './imported-runtime.generated.json'

interface ImportedHit {
  frame: number
  commit_frame: number
  motion_value: number
  motion_value_scaling: string
  attribute: string
  damage_type: string
}

export interface ImportedAbility {
  id: number
  name: string
  genre: string
  group_label: string
  total_frames: number
  earliest_frame_cancel: number
  no_swap: number
  time_stop: number
  motion_stop: number
  hits: ImportedHit[]
  tacetActionId: string | null
  match: 'direct' | 'additional' | 'unmapped'
}

const characters = source as unknown as Record<string, { sourceId:string; slug:string; name:string; abilities:ImportedAbility[] }>
const catalogByCharacter = new Map(generatedCharacterCatalog.map((character) => [character.id, character]))
const byAction = new Map<string, ImportedAbility>()
for (const [characterId, character] of Object.entries(characters)) {
  for (const ability of character.abilities) if (ability.tacetActionId) byAction.set(`${characterId}:${ability.tacetActionId}`, ability)
}

export function importedAbilityForAction(characterId: string, actionId: string) {
  return byAction.get(`${characterId}:${actionId}`)
}

export function importedAbilityForName(characterId: string, name: string) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const matches = characters[characterId]?.abilities.filter((ability) =>
    ability.tacetActionId && ability.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === normalized) ?? []
  return matches.length === 1 ? matches[0] : undefined
}

export function importedMinimumSequence(name: string) {
  const match = name.match(/(?:^S|\s-\sS)([1-6])\b/)
  return match ? Number(match[1]) : undefined
}

const damageTypes: Record<string, DamageType> = {
  basic_attack:'basic', heavy_attack:'heavy', resonance_skill:'skill', resonance_liberation:'liberation',
  intro:'intro', outro:'outro', echo_skill:'echo', tune_break:'tune-break'
}
const scalingStats: Record<string, ScalingStat> = { attack:'atk', hp:'hp', defense:'def' }
const elements = new Set<Element>(['spectro','fusion','glacio','electro','aero','havoc','physical'])

function castHits(characterId: string, ability: ImportedAbility) {
  // shortcut: Split only verified bundled triggers; review new mixed-hit imports before extending this list.
  const hits = ability.hits
  const mornye = characterId === '1209' && [417, 430].includes(ability.id)
  const rover = ['1309', '1310'].includes(characterId) && ability.id >= 999851 && ability.id <= 999864
  if (!mornye && !rover) return hits
  const first = hits[0]
  if (!first) return hits
  const primary = hits.filter((hit) => hit.damage_type === first.damage_type && hit.attribute === first.attribute)
  const triggered = hits.filter((hit) => hit.damage_type !== first.damage_type || hit.attribute !== first.attribute)
  if (mornye
    && triggered.length === 5 && triggered.every((hit) => hit.damage_type === 'resonance_liberation' && hit.attribute === 'fusion' && hit.motion_value === 3977)) return primary
  if (rover
    && triggered.length === primary.length && triggered.every((hit) => hit.damage_type === 'resonance_skill' && hit.attribute === 'electro' && hit.motion_value === 3977)) return primary
  return hits
}

function formulaFor(hits: ImportedHit[], motionValues?: number[]): ActionFormula {
  const scaling = new Set(hits.map((hit) => hit.motion_value_scaling))
  if (hits.every((hit) => hit.damage_type === 'tune_break')) return { kind:'unsupported', family:'Imported Tune Break variant needs a dedicated formula review' }
  if (scaling.size === 1 && scaling.has('fixed')) return { kind:'unsupported', family:'Imported fixed damage needs manual formula review' }
  const stat = scaling.size === 1 ? scalingStats[hits[0].motion_value_scaling] : undefined
  if (stat && hits.every((hit) => damageTypes[hit.damage_type] && hit.damage_type === hits[0].damage_type && hit.attribute === hits[0].attribute)) {
    return { kind:'damage', scaling:{ [stat]:1 }, hits:hits.map((hit, index) => motionValues?.[index] ?? hit.motion_value / 10000), canCrit:true }
  }
  return { kind:'unsupported', family:'Imported hit scaling or mixed damage types need manual review' }
}

function catalogMotionValues(characterId: string, ability: ImportedAbility, hits: ImportedHit[]) {
  const stat = scalingStats[hits[0]?.motion_value_scaling]
  if (!stat || hits.some((hit) => hit.motion_value_scaling !== hits[0].motion_value_scaling)) return undefined
  const attacks = catalogByCharacter.get(characterId)?.attacks.filter((attack) =>
    !isFixedSkillValueName(attack.name) && (attack.scalesWith === stat || characterId === '1209' && ability.id === 430 && attack.id === '1209-7-2') && attack.hitMultipliers.every((values) => values.length >= 10)) ?? []
  const candidates = attacks.flatMap((attack) => {
    const values = attack.hitMultipliers.map((levels) => Math.round(levels[9] * 10000))
    const exact = values.length === hits.length && values.every((value, index) => value === hits[index].motion_value)
    if (exact) return [{ attack, indexes:hits.map((_, index) => index), priority:0 }]
    if (values.length === 1 && hits.every((hit) => hit.motion_value === values[0])) return [{ attack, indexes:hits.map(() => 0), priority:1 }]
    return values.flatMap((_, start) => start + hits.length <= values.length && hits.every((hit, index) => values[start + index] === hit.motion_value)
      ? [{ attack, indexes:hits.map((_, index) => start + index), priority:2 }] : [])
  })
  const priority = Math.min(...candidates.map((candidate) => candidate.priority))
  const best = candidates.filter((candidate) => candidate.priority === priority)
  const preferred = best.filter(({ attack }) => attack.skillLevelIndex === skillLevelIndex(ability))
  const matches = preferred.length ? preferred : best
  const curve = (candidate: typeof matches[number]) => candidate.indexes.map((index) => candidate.attack.hitMultipliers[index])
  if (!matches.length || matches.some((candidate) => JSON.stringify(curve(candidate)) !== JSON.stringify(curve(matches[0])))) return undefined
  return matches[0]
}

function skillLevelIndex(ability: ImportedAbility) {
  const group = groupFor(ability)
  if (group === 'Forte Circuit') return 2
  if (group === 'Resonance Skill') return 1
  if (group === 'Resonance Liberation') return 3
  if (group === 'Intro Skill' || group === 'Outro Skill') return 4
  return 0
}

function groupFor(ability: ImportedAbility) {
  if (ability.genre === 'intro') return 'Intro Skill'
  if (ability.genre === 'outro') return 'Outro Skill'
  if (ability.genre === 'tunebreak') return 'Tune Break'
  if (ability.genre === 'echo') return 'Echo Skill'
  if (ability.name.startsWith('Forte:') || ability.group_label === 'forte') return 'Forte Circuit'
  if (ability.genre === 'skill' || ability.group_label === 'resonance skill') return 'Resonance Skill'
  if (ability.genre === 'liberation' || ability.group_label === 'resonance liberation') return 'Resonance Liberation'
  return 'Normal Attack'
}

export const importedAdditionalActions: Readonly<Record<string, Readonly<Record<string, CharacterActionMechanics>>>> = Object.fromEntries(
  Object.entries(characters).map(([characterId, character]) => [characterId, Object.fromEntries(
    character.abilities.filter((ability) => ability.match === 'additional' && (ability.hits.length || ability.genre === 'outro') && ability.tacetActionId).map((ability) => {
      const hits = castHits(characterId, ability)
      const hit = hits[0]
      const element = hit && elements.has(hit.attribute as Element) ? hit.attribute as Element : 'none'
      const damageType = hit ? damageTypes[hit.damage_type] ?? 'status' : 'outro'
      const formula: ActionFormula = hit ? formulaFor(hits) : { kind:'unsupported', family:'Non-damaging Outro cast' }
      const levelIndependent = ability.genre === 'outro' || /^Outro:/i.test(ability.name) || ability.genre === 'tunebreak'
      const catalogValues = hit && !levelIndependent ? catalogMotionValues(characterId, ability, hits) : undefined
      // shortcut: Unmatched imported variants have only a level 10 value; keep other levels unavailable until their curves are reviewed.
      const unavailable: ActionFormula = { kind:'unsupported', family:'Imported provides this damage value at skill level 10 only' }
      const formulas = levelIndependent ? { 1:formula } : Object.fromEntries(Array.from({ length:20 }, (_, index) => {
        const values = catalogValues?.indexes.map((hitIndex) => catalogValues.attack.hitMultipliers[hitIndex][index])
        const mapped = values?.every((value) => value !== undefined)
          ? formulaFor(hits, values) : undefined
        return [index + 1, mapped ?? (index === 9 ? formula : unavailable)]
      }))
      const action: CharacterActionMechanics = {
        id:ability.tacetActionId!, name:ability.name, group:groupFor(ability),
        sourceId:`imported:${character.slug}:${ability.id}`, reviewFingerprint:`unverified:imported:${ability.id}`,
        kind:hit ? 'damage' : 'utility', damageType, element, tags:[], skillLevelIndex:catalogValues?.attack.skillLevelIndex ?? skillLevelIndex(ability),
        ...(importedMinimumSequence(ability.name) === undefined ? {} : { minimumSequence:importedMinimumSequence(ability.name) }),
        formulas
      }
      return [action.id, action]
    })
  )])
)

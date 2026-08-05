import type { AggregatedStats, BuffEffect, Build, Echo, EnemyConfig, OwnedCharacter, OwnedWeapon } from '../types'
import { calculationCatalogV2 } from '../../game-data/calculation-v2.generated'
import type { CharacterCatalogEntry, WeaponCatalogEntry } from '../../game-data'
import { applyCalculationEffects, createEffectAccumulator } from './effects'
import { calculateAttackV2, calculateAttackV2Compact, type CompactCalculationResultV2 } from './damage'
import { calculationStatsFromAggregated } from './stats'
import type {
  CalculationAttackDefinition,
  CalculationEffectDefinition,
  CalculationEffectSelection,
  CalculationEnemyV2,
  CalculationResultV2,
  CalculationScenarioV2,
  CharacterCalculationMechanics,
  EchoCalculationMechanics,
  SonataCalculationMechanics,
  WeaponCalculationMechanics
} from './types'

const normalized = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

function closestByName<T extends { key: string; name: string }>(rows: T[], name: string, key = '') {
  const targetName = normalized(name)
  const targetKey = normalized(key)
  return rows.find((row) => normalized(row.name) === targetName)
    ?? rows.find((row) => normalized(row.key) === targetKey)
    ?? rows.find((row) => normalized(row.name).includes(targetName) || targetName.includes(normalized(row.name)))
}

export function resolveCharacterMechanicsV2(
  catalog: CharacterCatalogEntry,
  character: OwnedCharacter,
  roverGender: 'male' | 'female' = 'male'
): CharacterCalculationMechanics | undefined {
  const name = normalized(catalog.name)
  const element = normalized(catalog.element)
  if (name.startsWith('rover')) {
    const gender = roverGender === 'female' ? 'female' : 'male'
    return calculationCatalogV2.characters.find((entry) => {
      const key = normalized(entry.key)
      return key.includes('rover') && key.includes(element) && key.includes(gender)
    })
  }
  return closestByName(calculationCatalogV2.characters, catalog.name, character.catalogId)
}

export function resolveWeaponMechanicsV2(catalog: WeaponCatalogEntry | undefined): WeaponCalculationMechanics | undefined {
  return catalog ? closestByName(calculationCatalogV2.weapons, catalog.name, catalog.id) : undefined
}

export function resolveSonataMechanicsV2(name: string, pieces: number): SonataCalculationMechanics[] {
  const target = normalized(name)
  const matches = calculationCatalogV2.sonatas.filter((entry) =>
    normalized(entry.name) === target && entry.pieces <= pieces
  )
  const unique = new Map<string, SonataCalculationMechanics>()
  for (const entry of matches) {
    const current = unique.get(entry.id)
    if (!current) {
      unique.set(entry.id, entry)
      continue
    }
    const effectIds = new Set(current.effects.map((effect) => effect.id))
    unique.set(entry.id, {
      ...current,
      effects: [...current.effects, ...entry.effects.filter((effect) => !effectIds.has(effect.id))]
    })
  }
  return [...unique.values()]
}

export function resolveEchoMechanicsV2(echo: Echo | undefined): EchoCalculationMechanics | undefined {
  return echo ? closestByName(calculationCatalogV2.echoes, echo.name) : undefined
}

export function skillLevelForAttackV2(character: OwnedCharacter, attack: CalculationAttackDefinition) {
  const levels = character.skillLevels?.length === 5 ? character.skillLevels : [1, 1, 1, 1, 1]
  if (attack.group === 'Basic Attack') return levels[0] ?? 1
  if (attack.group === 'Resonance Skill') return levels[1] ?? 1
  if (attack.group === 'Forte Circuit') return levels[2] ?? 1
  if (attack.group === 'Resonance Liberation') return levels[3] ?? 1
  if (attack.group === 'Intro Skill') return levels[4] ?? 1
  return 1
}

function skillLevelMap(character: OwnedCharacter) {
  const levels = character.skillLevels?.length === 5 ? character.skillLevels : [1, 1, 1, 1, 1]
  return {
    basic: levels[0] ?? 1,
    skill: levels[1] ?? 1,
    forte: levels[2] ?? 1,
    liberation: levels[3] ?? 1,
    intro: levels[4] ?? 1
  }
}

function defaultSelections(effects: CalculationEffectDefinition[], refinement: number) {
  return Object.fromEntries(effects.map((effect) => [effect.id, {
    enabled: effect.alwaysEnabled || /^Stat Bonus:/i.test(effect.name),
    ...(effect.hasStacks ? { stacks: effect.minStacks } : {}),
    ...(effect.sourceKind === 'weapon' ? { refinement } : {})
  } satisfies CalculationEffectSelection]))
}

function customEffect(effect: BuffEffect): CalculationEffectDefinition {
  const modifier = effect.stat === 'atkPercent' ? 'ATK'
    : effect.stat === 'hpPercent' ? 'HP'
      : effect.stat === 'defPercent' ? 'DEF'
        : effect.stat === 'critRate' ? 'CritRate'
          : effect.stat === 'critDamage' ? 'CritDMG'
            : effect.stat === 'basicDamage' ? 'BasicAttackDMGBonus'
              : effect.stat === 'heavyDamage' ? 'HeavyAttackDMGBonus'
                : effect.stat === 'skillDamage' ? 'ResonanceSkillDMGBonus'
                  : effect.stat === 'liberationDamage' ? 'ResonanceLiberationDMGBonus'
                    : effect.stat === 'healingBonus' ? 'HealingBonus'
                      : effect.stat === 'amplify' ? 'DMGDeepen' : effect.stat
  return {
    id: `custom:${effect.id}`,
    key: effect.id,
    name: effect.name,
    description: 'Advanced custom modifier',
    sourceKind: 'custom',
    sourceId: effect.sourceBuildId,
    scope: effect.target,
    valueUnit: 'percent',
    alwaysEnabled: true,
    hasStacks: false,
    minStacks: 0,
    maxStacks: 0,
    duration: effect.duration,
    trigger: effect.triggerAttackId,
    stackingGroup: effect.stackingGroup,
    modifiers: [{ modifier, modifierValue: effect.value }]
  }
}

export interface BuildCalculationV2Sources {
  build: Build
  character: OwnedCharacter
  characterCatalog: CharacterCatalogEntry
  weapon?: OwnedWeapon
  weaponCatalog?: WeaponCatalogEntry
  showcase: {
    equipmentStats: AggregatedStats
    sonatas: Array<{ name: string; count: number }>
    echoSlots: Array<Echo | undefined>
  }
  scenario?: CalculationScenarioV2
  partyEffects?: CalculationEffectDefinition[]
  activeCustomBuffs?: BuffEffect[]
  roverGender?: 'male' | 'female'
}

export interface BuildCalculationV2Context {
  mechanics: CharacterCalculationMechanics
  weapon?: WeaponCalculationMechanics
  sonatas: SonataCalculationMechanics[]
  mainEcho?: EchoCalculationMechanics
  effects: CalculationEffectDefinition[]
  selections: Record<string, CalculationEffectSelection>
}

export function createBuildCalculationV2Context(input: BuildCalculationV2Sources): BuildCalculationV2Context | undefined {
  const mechanics = resolveCharacterMechanicsV2(input.characterCatalog, input.character, input.roverGender)
  if (!mechanics) return undefined
  const weapon = resolveWeaponMechanicsV2(input.weaponCatalog)
  const sonatas = input.showcase.sonatas.flatMap((sonata) => resolveSonataMechanicsV2(sonata.name, sonata.count))
  const mainEcho = resolveEchoMechanicsV2(input.showcase.echoSlots[0])
  const ownEffects = [
    ...mechanics.effects,
    ...mechanics.sequences,
    ...(weapon?.effects ?? []),
    ...sonatas.flatMap((sonata) => sonata.effects),
    ...(mainEcho?.effects ?? [])
  ]
  const partyEffects = input.partyEffects ?? []
  const strongestCustomBuffs = new Map<string, BuffEffect>()
  for (const effect of input.activeCustomBuffs ?? []) {
    const key = `${effect.stackingGroup}:${effect.stat}`
    const current = strongestCustomBuffs.get(key)
    if (!current || Math.abs(effect.value) > Math.abs(current.value)) strongestCustomBuffs.set(key, effect)
  }
  const customEffects = [...strongestCustomBuffs.values()].map(customEffect)
  const effects = [...ownEffects, ...partyEffects, ...customEffects]
  const memberSelections = input.scenario?.memberEffects[input.build.id] ?? {}
  const partySelections = input.scenario?.partyEffects[input.build.id] ?? {}
  const selections: Record<string, CalculationEffectSelection> = {
    ...defaultSelections(effects, input.weapon?.rank ?? 1),
    ...memberSelections,
    ...partySelections,
    ...Object.fromEntries(customEffects.map((effect) => [effect.id, { enabled: true }]))
  }
  for (const effect of effects) {
    if (/^Stat Bonus:/i.test(effect.name)) selections[effect.id] = { ...selections[effect.id], enabled: true }
  }
  return { mechanics, weapon, sonatas, mainEcho, effects, selections }
}

export function enemyV2(enemy: EnemyConfig, scenario?: CalculationScenarioV2): CalculationEnemyV2 {
  return {
    level: enemy.level,
    resistance: enemy.resistance,
    damageReduction: enemy.damageReduction,
    defenseIgnore: enemy.defenseIgnore ?? 0,
    defenseReduction: enemy.defenseReduction ?? 0,
    resistanceIgnore: enemy.resistanceIgnore ?? 0,
    resistanceReduction: enemy.resistanceReduction ?? 0,
    specialMultiplier: enemy.specialMultiplier ?? 0,
    enemyClass: 'overlord',
    statusStacks: scenario?.enemyStatuses ?? {}
  }
}

export function calculateBuildAttackV2(
  input: BuildCalculationV2Sources,
  attack: CalculationAttackDefinition,
  enemy: CalculationEnemyV2
): CalculationResultV2 | undefined {
  const context = createBuildCalculationV2Context(input)
  if (!context) return undefined
  const accumulator = createEffectAccumulator(calculationStatsFromAggregated(input.showcase.equipmentStats))
  const recipientIds = new Set([normalized(input.characterCatalog.name), normalized(input.character.catalogId)])
  const applicableEffects = context.effects.flatMap((effect) => {
    if (attack.excludeTeamBuffs && effect.sourceKind === 'party') return []
    if (attack.excludeWeaponBuffs && effect.sourceKind === 'weapon') return []
    if (attack.excludeEchoes && (effect.sourceKind === 'echo' || effect.sourceKind === 'sonata')) return []
    const modifiers = effect.modifiers.filter((modifier) => !modifier.specificCharacters?.length
      || modifier.specificCharacters.some((character) => recipientIds.has(normalized(character))))
    return modifiers.length ? [{ ...effect, modifiers }] : []
  })
  applyCalculationEffects(
    accumulator,
    applicableEffects,
    context.selections,
    attack,
    skillLevelMap(input.character),
    input.character.sequence,
    String(context.selections[`character:${context.mechanics.key}:stance`]?.value ?? '')
  )
  return calculateAttackV2({
    attack,
    talentLevel: skillLevelForAttackV2(input.character, attack),
    characterLevel: input.character.level,
    accumulator,
    enemy
  })
}

export interface PreparedBuildAttackV2 {
  attack: CalculationAttackDefinition
  enemy: CalculationEnemyV2
  effects: CalculationEffectDefinition[]
  selections: Record<string, CalculationEffectSelection>
  skillLevels: ReturnType<typeof skillLevelMap>
  sequence: number
  stance: string
  talentLevel: number
  characterLevel: number
}

/** Resolve invariant mechanics once for optimizer builds that share a main Echo and Sonata signature. */
export function prepareBuildAttackV2(
  input: BuildCalculationV2Sources,
  attack: CalculationAttackDefinition,
  enemy: CalculationEnemyV2
): PreparedBuildAttackV2 | undefined {
  const context = createBuildCalculationV2Context(input)
  if (!context) return undefined
  const recipientIds = new Set([normalized(input.characterCatalog.name), normalized(input.character.catalogId)])
  const effects = context.effects.flatMap((effect) => {
    if (attack.excludeTeamBuffs && effect.sourceKind === 'party') return []
    if (attack.excludeWeaponBuffs && effect.sourceKind === 'weapon') return []
    if (attack.excludeEchoes && (effect.sourceKind === 'echo' || effect.sourceKind === 'sonata')) return []
    const modifiers = effect.modifiers.filter((modifier) => !modifier.specificCharacters?.length
      || modifier.specificCharacters.some((character) => recipientIds.has(normalized(character))))
    return modifiers.length ? [{ ...effect, modifiers }] : []
  })
  return {
    attack,
    enemy,
    effects,
    selections: context.selections,
    skillLevels: skillLevelMap(input.character),
    sequence: input.character.sequence,
    stance: String(context.selections[`character:${context.mechanics.key}:stance`]?.value ?? ''),
    talentLevel: skillLevelForAttackV2(input.character, attack),
    characterLevel: input.character.level
  }
}

export function calculatePreparedBuildAttackV2(
  prepared: PreparedBuildAttackV2,
  equipmentStats: AggregatedStats
): CompactCalculationResultV2 {
  const accumulator = createEffectAccumulator(calculationStatsFromAggregated(equipmentStats))
  applyCalculationEffects(
    accumulator,
    prepared.effects,
    prepared.selections,
    prepared.attack,
    prepared.skillLevels,
    prepared.sequence,
    prepared.stance
  )
  return calculateAttackV2Compact({
    attack: prepared.attack,
    talentLevel: prepared.talentLevel,
    characterLevel: prepared.characterLevel,
    accumulator,
    enemy: prepared.enemy
  })
}

export function outgoingPartyEffectsV2(
  characterCatalog: CharacterCatalogEntry | undefined,
  weaponCatalog: WeaponCatalogEntry | undefined,
  mainEcho: Echo | undefined,
  sonatas: Array<{ name: string; count: number }>,
  characterMechanicsKey?: string
) {
  if (!characterCatalog) return []
  const characterNames = new Set([
    normalized(characterCatalog.name),
    normalized(characterCatalog.id),
    normalized(characterMechanicsKey)
  ].filter(Boolean))
  const weaponNames = new Set(weaponCatalog ? [normalized(weaponCatalog.name)] : [])
  const echoNames = new Set(mainEcho ? [normalized(mainEcho.name)] : [])
  const sonataNames = new Set(sonatas.map((sonata) => normalized(sonata.name)))
  return calculationCatalogV2.partyEffects.filter((effect) => {
    const source = normalized(effect.sourceId)
    if (source.startsWith('weapon')) return [...weaponNames].some((name) => source.includes(name))
    if (source.startsWith('echo')) return [...echoNames, ...sonataNames].some((name) => source.includes(name))
    return characterNames.has(source)
  })
}

export { calculationCatalogV2 }

import type { DamageType, EffectMechanics, EffectOperation, Element, MechanicsRegistry, Stat, StatValue } from '../../domain/combat'
import { generatedCharacterCatalog } from '../characters.generated'
import { generatedWeaponCatalog } from '../weapons.generated'
import { reviewedMechanicsCatalog } from './reviewed-mechanics.generated'
import { supplementalCharacterActions } from './supplemental-character-actions'
import { wutheringToolsActionClassification } from './wutheringtools-action-classification.generated'
import { wutheringToolsEffectScopes } from './wutheringtools-effect-scopes.generated'

const ratio = (value: string) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed / 100 : 0
}

const secondaryStat = (name: string, value: string): StatValue[] => {
  const normalized = name.toLowerCase()
  const stat: Stat | undefined = normalized.includes('crit. rate') || normalized.includes('crit rate') ? 'critRate'
    : normalized.includes('crit. dmg') || normalized.includes('crit dmg') ? 'critDamage'
      : normalized.includes('energy regen') ? 'energyRegen'
        : normalized.includes('healing bonus') ? 'healingBonus'
          : normalized === 'atk' || normalized.includes('atk%') ? 'atk'
            : normalized === 'hp' || normalized.includes('hp%') ? 'hp'
              : normalized === 'def' || normalized.includes('def%') ? 'def' : undefined
  if (!stat) return []
  return [{ stat, mode:stat === 'atk' || stat === 'hp' || stat === 'def' ? 'percent' : 'flat', value:ratio(value) }]
}

const DAMAGE_TYPE_STATS: Partial<Record<DamageType, Stat>> = {
  basic:'basicDamage', heavy:'heavyDamage', skill:'skillDamage', liberation:'liberationDamage',
  intro:'introDamage', outro:'outroDamage', echo:'echoDamage', 'tune-break':'tuneBreakDamage'
}
const ELEMENT_STATS: Partial<Record<Element, Stat>> = {
  spectro:'spectroDamage', fusion:'fusionDamage', glacio:'glacioDamage', electro:'electroDamage',
  aero:'aeroDamage', havoc:'havocDamage', physical:'physicalDamage'
}

const normalizeDamageBonusStats = (operation: EffectOperation): EffectOperation[] => {
  if (operation.kind !== 'add-damage-bonus' || !operation.filter || operation.filter.actionIds?.length || operation.filter.tags?.length) return [operation]
  const scopedStats = operation.filter.damageTypes?.length && !operation.filter.elements?.length
    ? operation.filter.damageTypes.map((damageType) => DAMAGE_TYPE_STATS[damageType])
    : operation.filter.elements?.length && !operation.filter.damageTypes?.length
      ? operation.filter.elements.map((element) => ELEMENT_STATS[element])
      : []
  if (!scopedStats.length || scopedStats.some((stat) => !stat)) return [operation]
  const { filter: _filter, ...rest } = operation
  return [...new Set(scopedStats)].map((stat) => ({ ...rest, kind:'add-flat-stat', stat:stat! }))
}

const normalizeReviewedEffect = (effect: EffectMechanics): EffectMechanics => {
  const scopeCorrection = wutheringToolsEffectScopes[effect.id] ?? wutheringToolsEffectScopes[effect.sourceId]
  const reviewedEffect = scopeCorrection ? {
    ...effect,
    ...(effect.filter && scopeCorrection.all ? { filter:{ ...effect.filter, actionIds:scopeCorrection.all } } : {}),
    operations:effect.operations.map((operation, index) => {
      const actionIds = scopeCorrection.byOperation?.[index] ?? scopeCorrection.all
      const upstreamFilter = scopeCorrection.filtersByOperation?.[index]
      const corrected = upstreamFilter === null
        ? (({ filter: _filter, ...unfiltered }) => unfiltered)(operation)
        : upstreamFilter ? { ...operation, filter:upstreamFilter } : operation
      return actionIds ? { ...corrected, filter:{ ...corrected.filter, actionIds } } : corrected
    }).filter((operation) => !scopeCorrection.blockUnscoped || effect.filter?.actionIds?.length || operation.filter?.actionIds?.length)
  } : effect
  const description = reviewedEffect.description ?? ''
  const tuneBreakScaledDamage = /(?:each|every) point of [\s\S]*Tune Break Boost increases [\s\S]*total DMG/i.test(description)
  const reductions = new Set(reviewedEffect.operations.filter((operation) => operation.kind === 'reduce-damage-taken').map((operation) => operation.value))
  const teamBonuses = new Set(reviewedEffect.operations.filter((operation) => operation.kind === 'add-damage-bonus' && operation.recipient === 'team').map((operation) => operation.value))
  const operations = reviewedEffect.operations.flatMap((operation): EffectOperation[] => {
    if (tuneBreakScaledDamage && operation.kind === 'add-damage-bonus') {
      if (operation.filter?.damageTypes?.includes('tune-break')) return []
      return [{ ...operation, stacking:'per-stack' }]
    }
    if (operation.kind !== 'add-damage-bonus' || operation.filter) return [operation]
    if (/DMG Reduction/i.test(description) && reductions.has(operation.value)) return []
    if (/Attribute DMG Bonus for all Resonators/i.test(description) && operation.recipient !== 'team' && teamBonuses.has(operation.value)) return []
    if (/\bBasic(?: Attack)? DMG Bonus\b/i.test(description)) return [{ ...operation, filter:{ damageTypes:['basic'] } }]
    return [operation]
  }).flatMap(normalizeDamageBonusStats)
  const activation = tuneBreakScaledDamage ? {
    kind:'conditional-value' as const,
    toggleInput:reviewedEffect.activation.kind === 'always' ? reviewedEffect.id : reviewedEffect.activation.kind === 'all' ? reviewedEffect.id : reviewedEffect.activation.kind === 'conditional-value' ? reviewedEffect.activation.toggleInput : reviewedEffect.activation.input,
    source:'provider' as const,
    stat:'tuneBreakBoost' as const,
    minimum:0,
    maximum:250
  } : reviewedEffect.activation
  return operations.length === reviewedEffect.operations.length && operations.every((operation, index) => operation === reviewedEffect.operations[index]) && activation === reviewedEffect.activation ? reviewedEffect : { ...reviewedEffect, activation, operations }
}

const normalizeReviewedEffects = (effects: readonly EffectMechanics[] | undefined) => effects?.map(normalizeReviewedEffect)
const isSkillTreeStatNodeEffect = (effect: EffectMechanics) => /:\d+:(?:9|10|11|12|13|14|15|16):effect:0$/.test(effect.id)
  && /^(?:ATK|HP|DEF|Crit\.(?: Rate| DMG)|Energy Regen|Healing Bonus|(?:Spectro|Fusion|Glacio|Electro|Aero|Havoc) DMG Bonus)\+$/.test(effect.name ?? '')

export const mechanicsRegistry: MechanicsRegistry = {
  dataVersion:reviewedMechanicsCatalog.dataVersion,
  characters:Object.fromEntries(generatedCharacterCatalog.flatMap((character) => {
    const reviewed = reviewedMechanicsCatalog.characters[character.id]
    if (!reviewed) return []
    return [[character.id, {
      id:character.id,
      sourceId:reviewed.sourceId,
      reviewFingerprint:reviewed.reviewFingerprint,
      levelStats:character.levelStats.map((stats) => ({
        ...stats,
        critRate:character.baseStats.critRate / 100,
        critDamage:character.baseStats.critDamage / 100,
        energyRegen:1
      })),
      actions:Object.fromEntries(Object.entries({ ...reviewed.actions, ...(supplementalCharacterActions[character.id] ?? {}) }).map(([id, action]) => {
        const correction = wutheringToolsActionClassification[id]
        const damageType = action.damageType === 'tuneBreak' ? 'tune-break' : correction?.damageType ?? action.damageType
        const tags = [...new Set([...(action.tags ?? []), ...(correction?.addTags ?? [])])]
        const formulas = 'formulas' in action && correction && (correction.scalingStat || correction.hitsByLevel) ? Object.fromEntries(Object.entries(action.formulas).map(([level, formula]) => [level, {
          ...formula,
          ...('hits' in formula && correction.hitsByLevel?.[Number(level)] ? { hits:correction.hitsByLevel[Number(level)] } : {}),
          ...('scaling' in formula && correction.scalingStat ? { scaling:{ [correction.scalingStat]:Object.values(formula.scaling).reduce((total, value) => total + value, 0) } } : {})
        }])) : 'formulas' in action ? action.formulas : undefined
        return [id, { ...action, damageType, ...(tags.length ? { tags } : {}), ...(formulas ? { formulas } : {}) }]
      })),
      effects:normalizeReviewedEffects(reviewed.effects?.filter((effect) => !isSkillTreeStatNodeEffect(effect)))
    }]]
  })),
  weapons:Object.fromEntries(generatedWeaponCatalog.flatMap((weapon) => {
    const reviewed = reviewedMechanicsCatalog.weapons[weapon.id]
    if (!reviewed) return []
    return [[weapon.id, {
      id:weapon.id,
      sourceId:reviewed.sourceId,
      reviewFingerprint:reviewed.reviewFingerprint,
      levelStats:weapon.levelStats.map((stats) => ({ level:stats.level, atk:stats.baseAtk, stats:secondaryStat(weapon.secondaryStat, stats.secondaryStatValue) })),
      effects:normalizeReviewedEffects(reviewed.effects)
    }]]
  })),
  echoes:Object.fromEntries(Object.entries(reviewedMechanicsCatalog.echoes ?? {}).map(([id, echo]) => [id, { ...echo, effects:normalizeReviewedEffects(echo.effects) ?? [] }])),
  sonatas:Object.fromEntries(Object.entries(reviewedMechanicsCatalog.sonatas ?? {}).map(([id, sonata]) => [id, { ...sonata, effects:normalizeReviewedEffects(sonata.effects) ?? [] }]))
}

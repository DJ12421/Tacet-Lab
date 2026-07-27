export { echoCatalog, type EchoCatalogEntry } from './echoes'
export { characterCatalog, characterSummaries, weaponCatalog, weaponSummaries, sonataCatalog, catalogProvenance } from './catalog'
export type { CharacterCatalogEntry, CharacterSummary, WeaponCatalogEntry, WeaponSummary, SonataCatalogEntry } from './catalog'
export { GAME_DATA_VERSION, defaultSettings, resonators, statAliases, statLabels, weapons } from './core'
export { isFixedSkillValueName } from './attack-values'
export { baseTuneBreakBoost } from './tune-break'
export {
  weaponPassiveConditions,
  type WeaponConditionEffect, type WeaponPassiveCondition
} from './weapon-conditions'
export {
  characterConditionCard, characterConditionCatalogKey, characterConditionId, characterConditionInherentSkillIndex, characterConditionModeId,
  characterConditionModes, characterConditionRequiresToggle, characterConditionStackId, characterConditions, conditionTargetsAttack,
  characterConditionProvenance,
  type CharacterCondition, type CharacterConditionModifier, type CharacterSkillCardKey
} from './character-conditions'
import { generatedSonataCatalog } from './sonatas.generated'
export const sonataNames = generatedSonataCatalog.map((sonata) => sonata.name)

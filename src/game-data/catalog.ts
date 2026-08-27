import { generatedCharacterCatalog } from './characters.generated'
import { mechanicsCatalog } from './mechanics'

const normalizedCatalogKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const legacyAttackTypes = new Set(['basic', 'heavy', 'skill', 'liberation', 'intro', 'outro', 'healing'])
const mechanicsCharacterByKey = new Map(mechanicsCatalog.characters.map((character) => [normalizedCatalogKey(character.name), character]))
const nanokaFallbackAttackType = (attack: typeof generatedCharacterCatalog[number]['attacks'][number]) => {
  if (attack.type === 'healing') return 'healing'
  if (/outro/i.test(attack.name)) return 'outro'
  if (attack.skillLevelIndex === 4 || /intro/i.test(attack.name)) return 'intro'
  if (/heavy attack/i.test(attack.name)) return 'heavy'
  if (attack.skillLevelIndex === 0) return 'basic'
  if (attack.skillLevelIndex === 3) return 'liberation'
  return 'skill'
}

export const characterCatalog = generatedCharacterCatalog.map((character) => {
  const mechanics = mechanicsCharacterByKey.get(normalizedCatalogKey(character.name))
  if (!mechanics) return character
  return {
    ...character,
    attacks:character.attacks.map((attack) => {
      const attackKey = normalizedCatalogKey(attack.name)
      const matchingTypes = new Set(mechanics.attacks
        .filter((candidate) => {
          const candidateKey = normalizedCatalogKey(candidate.name)
          return candidateKey === attackKey || (candidateKey.length >= 6 && (candidateKey.endsWith(attackKey) || attackKey.endsWith(candidateKey)))
        })
        .map((candidate) => candidate.type)
        .filter((type) => legacyAttackTypes.has(type)))
      const type = matchingTypes.size === 1 ? [...matchingTypes][0] : nanokaFallbackAttackType(attack)
      return { ...attack, type:type as typeof attack.type }
    })
  }
})
export { generatedCharacterSummaries as characterSummaries } from './character-summaries.generated'
export { generatedWeaponCatalog as weaponCatalog } from './weapons.generated'
export { generatedWeaponSummaries as weaponSummaries } from './weapon-summaries.generated'
export { generatedSonataCatalog as sonataCatalog } from './sonatas.generated'
export { catalogProvenance } from './catalog-provenance.generated'
export type {
  GeneratedCharacterCatalogEntry as CharacterCatalogEntry,
  GeneratedCharacterSummary as CharacterSummary,
  GeneratedWeaponCatalogEntry as WeaponCatalogEntry,
  GeneratedWeaponSummary as WeaponSummary,
  GeneratedSonataCatalogEntry as SonataCatalogEntry
} from './catalog-types.generated'

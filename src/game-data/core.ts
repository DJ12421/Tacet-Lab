import type { AppSettings, Resonator, StatKey, Weapon } from '../domain/types'

export const GAME_DATA_VERSION = 'nanoka-3.5-catalog'

export const statLabels: Record<StatKey, string> = {
  hp: 'HP', hpPercent: 'HP %', atk: 'ATK', atkPercent: 'ATK %', def: 'DEF', defPercent: 'DEF %',
  critRate: 'Crit. Rate', critDamage: 'Crit. DMG', energyRegen: 'Energy Regen', basicDamage: 'Basic Attack',
  heavyDamage: 'Heavy Attack', skillDamage: 'Res. Skill', liberationDamage: 'Res. Liberation',
  spectroDamage: 'Spectro DMG', fusionDamage: 'Fusion DMG', glacioDamage: 'Glacio DMG', electroDamage: 'Electro DMG',
  aeroDamage: 'Aero DMG', havocDamage: 'Havoc DMG', healingBonus: 'Healing Bonus'
}

export const statAliases: Array<[RegExp, StatKey]> = [
  [/^hp\s*%$/i, 'hpPercent'], [/^atk\s*%$/i, 'atkPercent'], [/^def\s*%$/i, 'defPercent'],
  [/^hp$/i, 'hp'], [/^atk$/i, 'atk'], [/^def$/i, 'def'],
  [/crit(?:ical)?\.?\s*rate/i, 'critRate'], [/crit(?:ical)?\.?\s*(?:dmg|damage)/i, 'critDamage'],
  [/energy\s*regen/i, 'energyRegen'], [/basic\s*attack/i, 'basicDamage'], [/heavy\s*attack/i, 'heavyDamage'],
  [/(?:res\.?|resonance)\s*skill/i, 'skillDamage'], [/(?:res\.?|resonance)\s*liberation/i, 'liberationDamage'],
  [/spectro\s*dmg/i, 'spectroDamage'], [/fusion\s*dmg/i, 'fusionDamage'], [/glacio\s*dmg/i, 'glacioDamage'],
  [/electro\s*dmg/i, 'electroDamage'], [/aero\s*dmg/i, 'aeroDamage'], [/havoc\s*dmg/i, 'havocDamage'],
  [/healing\s*bonus/i, 'healingBonus']
]

// Combat definitions stay empty until a complete, verifiable formula source is
// imported. Catalog pages never invent stats or multipliers.
export const resonators: Resonator[] = []
export const weapons: Weapon[] = []

export const defaultSettings: AppSettings = {
  displayName: 'Resonator', privacyMode: false, background: 'signal', scanIntervalMs: 900,
  roverGender: 'male',
  scoreWeights: {},
  characterSubstatWeights: {}
}

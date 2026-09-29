import type { StatKey } from '../domain/types'

const STAT_ICON_NAMES: Record<StatKey, string> = {
  hp: 'Icon_Attribute_Health.webp',
  hpPercent: 'Icon_Attribute_Health.webp',
  atk: 'Icon_Attribute_Attack.webp',
  atkPercent: 'Icon_Attribute_Attack.webp',
  def: 'Icon_Attribute_Defense.webp',
  defPercent: 'Icon_Attribute_Defense.webp',
  critRate: 'Icon_Attribute_Crit_Rate.webp',
  critDamage: 'Icon_Attribute_Crit_DMG.webp',
  energyRegen: 'Icon_Attribute_Energy_Regen.webp',
  healingBonus: 'Icon_Attribute_Healing.webp',
  basicDamage: 'Icon_Basic_Attack_DMG_Amplification.webp',
  heavyDamage: 'Icon_Heavy_Attack_DMG_Amplification.webp',
  skillDamage: 'Icon_Resonance_Skill_DMG_Amplification.webp',
  liberationDamage: 'Icon_Resonance_Liberation_DMG_Amplification.webp',
  glacioDamage: 'Icon_Glacio_DMG_Bonus.webp',
  fusionDamage: 'Icon_Fusion_DMG_Bonus.webp',
  electroDamage: 'Icon_Electro_DMG_Bonus.webp',
  aeroDamage: 'Icon_Aero_DMG_Bonus.webp',
  spectroDamage: 'Icon_Spectro_DMG_Bonus.webp',
  havocDamage: 'Icon_Havoc_DMG_Bonus.webp'
}

export function statIconSource(stat: StatKey) {
  return `https://wuwa-optimizer.com/images/icons/${STAT_ICON_NAMES[stat]}`
}

const WEAPON_STAT_KEYS: Record<string, StatKey> = {
  ATK: 'atkPercent',
  DEF: 'defPercent',
  HP: 'hpPercent',
  'Crit. Rate': 'critRate',
  'Crit. DMG': 'critDamage',
  'Energy Regen': 'energyRegen'
}

export function weaponStatIconSource(label: string) {
  return statIconSource(WEAPON_STAT_KEYS[label] ?? 'atk')
}

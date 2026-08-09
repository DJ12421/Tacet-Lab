import type { StatKey } from '../domain/types'

export type CharacterSubstatPreferenceWeight = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4

export interface CharacterSubstatPreference {
  weights: Partial<Record<StatKey, CharacterSubstatPreferenceWeight>>
}

export const characterSubstatScoreKeys: StatKey[] = [
  'critRate', 'critDamage', 'energyRegen',
  'atkPercent', 'hpPercent', 'defPercent',
  'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage',
  'atk', 'hp', 'def'
]

// Defaults with a DPR Calc Results Substat Value graph are normalized per character:
// the highest plotted value is 4, zero is omitted, and other values round to the
// nearest 0.5. Multiple build graphs for one character are weighted equally.
// Characters without a usable graph retain their previously published priorities.
export const characterSubstatPreferences: Record<string, CharacterSubstatPreference> = {
  Aalto: { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, atk: 1 } },
  Aemeath: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 1.5, atk: 1 } },
  Augusta: { weights: { critRate: 3.5, critDamage: 4, atkPercent: 1.5, heavyDamage: 1.5, atk: 0.5 } },
  Baizhi: { weights: {} },
  Brant: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, basicDamage: 3, atkPercent: 2, atk: 1 } },
  Buling: { weights: { critRate: 3, critDamage: 4, atkPercent: 2.5, skillDamage: 0.5, liberationDamage: 2, basicDamage: 1, atk: 1.5 } },
  Calcharo: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Camellya: { weights: { critRate: 3, critDamage: 4, atkPercent: 2, basicDamage: 1, atk: 1 } },
  Cantarella: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Carlotta: { weights: { critRate: 4, critDamage: 2.5, atkPercent: 2, skillDamage: 1.5, atk: 1 } },
  Cartethyia: { weights: { critRate: 4, critDamage: 1, hpPercent: 2, basicDamage: 1.5, skillDamage: 0.5, liberationDamage: 0.5, hp: 0.5 } },
  Changli: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  Chisa: { weights: { critRate: 4, critDamage: 4, atkPercent: 2.5, liberationDamage: 2, atk: 1.5 } },
  Chixia: { weights: {} },
  Ciaccona: { weights: { critRate: 4, critDamage: 2.5, atkPercent: 2.5, basicDamage: 0.5, heavyDamage: 0.5, liberationDamage: 1, atk: 1.5 } },
  Danjin: { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, atk: 1 } },
  Denia: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 2, atk: 1 } },
  Encore: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Galbrena: { weights: { critRate: 4, critDamage: 3.5, atkPercent: 1.5, heavyDamage: 1, atk: 1 } },
  Hiyuki: { weights: { critRate: 3.5, critDamage: 4, atkPercent: 2, liberationDamage: 1.5, atk: 1 } },
  Iuno: { weights: { critRate: 3.5, critDamage: 4, atkPercent: 2, liberationDamage: 2, atk: 1 } },
  Jianxin: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, energyRegen: 2, liberationDamage: 3, atk: 1 } },
  Jinhsi: { weights: { critRate: 4, critDamage: 2.5, atkPercent: 2, skillDamage: 1.5, liberationDamage: 0.5, atk: 1 } },
  Jiyan: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Lingyang: { weights: {} },
  Lucilla: { weights: { critRate: 3.5, critDamage: 4, atkPercent: 2, basicDamage: 1.5, skillDamage: 0.5, atk: 1 } },
  Lucy: { weights: { critRate: 4, critDamage: 3.5, atkPercent: 1.5, heavyDamage: 1.5, atk: 1 } },
  Lumi: { weights: {} },
  Lupa: { weights: { critRate: 4, critDamage: 3, atkPercent: 2, liberationDamage: 1.5, atk: 1 } },
  'Luuk Herssen': { weights: { critRate: 4, critDamage: 3.5, atkPercent: 2, basicDamage: 1.5, atk: 1 } },
  Lynae: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 1.5, liberationDamage: 0.5, atk: 1 } },
  Mornye: { weights: { critRate: 2, critDamage: 4, energyRegen: 3.5, atkPercent: 1.5, defPercent: 3, basicDamage: 0.5, heavyDamage: 0.5, liberationDamage: 4, atk: 1, def: 1 } },
  Mortefi: { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Phoebe: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Phrolova: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 1, atk: 1 } },
  Qiuyuan: { weights: { critRate: 3.5, critDamage: 4, atkPercent: 2, heavyDamage: 1, atk: 1 } },
  Rebecca: { weights: { critRate: 4, critDamage: 3, atkPercent: 1.5, basicDamage: 1.5, atk: 1 } },
  Roccia: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  'Rover: Aero': { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  'Rover: Electro': { weights: {} },
  'Rover: Havoc': { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, atk: 1 } },
  'Rover: Spectro': { weights: { energyRegen: 2, critRate: 4, critDamage: 4, skillDamage: 3, atkPercent: 2, atk: 1 } },
  Sanhua: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, energyRegen: 2, liberationDamage: 3, atk: 1 } },
  Shorekeeper: { weights: { energyRegen: 2, hpPercent: 2, critDamage: 4, liberationDamage: 3, hp: 1 } },
  Sigrika: { weights: { critRate: 4, critDamage: 3.5, energyRegen: 1.5, atkPercent: 2, atk: 1 } },
  Suisui: { weights: { critRate: 2.5, critDamage: 4, atkPercent: 1, hpPercent: 2, basicDamage: 2, skillDamage: 0.5, atk: 1, hp: 0.5 } },
  Taoqi: { weights: {} },
  Verina: { weights: { energyRegen: 2, atkPercent: 2, atk: 1 } },
  'Xiangli Yao': { weights: { critRate: 3, critDamage: 4, atkPercent: 2, skillDamage: 0.5, liberationDamage: 1, atk: 1 } },
  Yangyang: { weights: {} },
  'Yangyang: Xuanling': { weights: { critRate: 4, critDamage: 3, atkPercent: 2, heavyDamage: 2, atk: 1 } },
  Yinlin: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  Youhu: { weights: {} },
  Yuanwu: { weights: {} },
  Zani: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Zhezhi: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } }
}

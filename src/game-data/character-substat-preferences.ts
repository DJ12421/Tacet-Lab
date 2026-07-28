import type { StatKey } from '../domain/types'

export type CharacterSubstatPreferenceWeight = 0 | 1 | 2 | 3 | 4

export interface CharacterSubstatPreference {
  weights: Partial<Record<StatKey, CharacterSubstatPreferenceWeight>>
}

// Edit this table to change character-specific Echo substat priorities.
// 4 = highest, 3 = strong, 2 = useful, 1 = marginal, 0/omitted = irrelevant.
//
// Weight by stat type: CR/CD = 4, damage bonus = 3, percentage stat/ER = 2,
// and flat stat = 1. One matching flat stat may be included as a sixth preference.
// Empty entries do not currently have a published substat priority.
export const characterSubstatPreferences: Record<string, CharacterSubstatPreference> = {
  Aalto: { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, atk: 1 } },
  Aemeath: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Augusta: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Baizhi: { weights: {} },
  Brant: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, basicDamage: 3, atkPercent: 2, atk: 1 } },
  Buling: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Calcharo: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Camellya: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Cantarella: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Carlotta: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  Cartethyia: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, hpPercent: 2, basicDamage: 3, hp: 1 } },
  Changli: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  Chisa: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Chixia: { weights: {} },
  Ciaccona: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Danjin: { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, atk: 1 } },
  Denia: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Encore: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Galbrena: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Hiyuki: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Iuno: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, liberationDamage: 3, atkPercent: 2, atk: 1 } },
  Jianxin: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, energyRegen: 2, liberationDamage: 3, atk: 1 } },
  Jinhsi: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  Jiyan: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Lingyang: { weights: {} },
  Lucilla: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Lucy: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Lumi: { weights: {} },
  Lupa: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  'Luuk Herssen': { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Lynae: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Mornye: { weights: { energyRegen: 2, liberationDamage: 3, critDamage: 4, defPercent: 2, atkPercent: 2, def: 1 } },
  Mortefi: { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Phoebe: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Phrolova: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  Qiuyuan: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Rebecca: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } },
  Roccia: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  'Rover: Aero': { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  'Rover: Electro': { weights: {} },
  'Rover: Havoc': { weights: { critRate: 4, critDamage: 4, energyRegen: 2, atkPercent: 2, atk: 1 } },
  'Rover: Spectro': { weights: { energyRegen: 2, critRate: 4, critDamage: 4, skillDamage: 3, atkPercent: 2, atk: 1 } },
  Sanhua: { weights: { critRate: 4, critDamage: 4, atkPercent: 2, energyRegen: 2, liberationDamage: 3, atk: 1 } },
  Shorekeeper: { weights: { energyRegen: 2, hpPercent: 2, critDamage: 4, liberationDamage: 3, hp: 1 } },
  Sigrika: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, atk: 1 } },
  Suisui: { weights: {} },
  Taoqi: { weights: {} },
  Verina: { weights: { energyRegen: 2, atkPercent: 2, atk: 1 } },
  'Xiangli Yao': { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, liberationDamage: 3, atk: 1 } },
  Yangyang: { weights: {} },
  'Yangyang: Xuanling': { weights: { energyRegen: 2, critRate: 4, critDamage: 4, heavyDamage: 3, atkPercent: 2, atk: 1 } },
  Yinlin: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, skillDamage: 3, atk: 1 } },
  Youhu: { weights: {} },
  Yuanwu: { weights: {} },
  Zani: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, heavyDamage: 3, atk: 1 } },
  Zhezhi: { weights: { energyRegen: 2, critRate: 4, critDamage: 4, atkPercent: 2, basicDamage: 3, atk: 1 } }
}

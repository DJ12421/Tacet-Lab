import type { ActionFormula, CharacterActionMechanics, Element, ResultKind, ScalingStat } from '../../domain/combat'

type ActionMap = Record<string, CharacterActionMechanics>
type SupplementalMap = Record<string, ActionMap>

const supplemental: SupplementalMap = {}

function addAction(characterId: string, action: CharacterActionMechanics) {
  supplemental[characterId] ??= {}
  supplemental[characterId][action.id] = action
}

function reviewedAction(input: {
  characterId: string
  id: string
  name: string
  group: string
  kind: ResultKind
  formula: ActionFormula
  skillLevelIndex?: number
  damageType?: CharacterActionMechanics['damageType']
  element?: Element
  tags?: CharacterActionMechanics['tags']
}) {
  addAction(input.characterId, {
    id:input.id,
    name:input.name,
    group:input.group,
    sourceId:`character:${input.characterId}:supplemental:${input.id}`,
    reviewFingerprint:`manual-reviewed:3.6:2026-09-28:${input.id}`,
    kind:input.kind,
    damageType:input.damageType,
    element:input.element,
    tags:input.tags,
    skillLevelIndex:input.skillLevelIndex ?? 4,
    formulas:{ 1:input.formula }
  })
}

const outros: Array<[string, string, string, Element, ScalingStat, number[]]> = [
  ['1301','1301:8:outro','Shadowy Raid - Outro Skill DMG','electro','atk',[1.9598,3.9196]],
  ['1603','1603:8:outro','Twining - Outro Skill DMG','havoc','atk',[3.2924]],
  ['1107','1107:8:outro','Closing Remark - Outro Skill DMG','glacio','atk',[7.942]],
  ['1202','1202:8:outro','Leaping Flames - Outro Skill DMG','fusion','atk',[5.3]],
  ['1203','1203:8:outro','Thermal Field - Outro Skill DMG','fusion','atk',[1.7676]],
  ['1410','1410:8:outro','From Gloom to Gleam - Outro Skill DMG','aero','atk',[1]],
  ['1212','1212:8:outro','Rising Fortune and Ebbing Evil - Outro Skill DMG','fusion','atk',[7.95]],
  ['1404','1404:8:outro','Discipline - Outro Skill DMG','aero','atk',[3.134]],
  ['1104','1104:8:outro','Frosty Marks - Outro Skill DMG','glacio','atk',[5.8794]],
  ['1510','1510:8:outro','Bow to the Last Light - Outro Skill DMG','spectro','atk',[5]],
  ['1509','1509:8:outro',"Let's Hit the Road! - Outro Skill DMG",'spectro','atk',[1]],
  ['1506','1506:8:outro','Attentive Heart - Outro Skill DMG','spectro','atk',[5.2841]],
  ['1413','1413:8:outro','Lingering Song - Outro Skill DMG','aero','atk',[8]],
  ['1411','1411:8:outro','Strike Before Ready - Outro Skill DMG','aero','atk',[1]],
  ['1308','1308:8:outro','Preem Choom - Outro Skill DMG per hit','electro','atk',[0.025]],
  ['1604','1604:8:outro','Soundweaver - Outro Skill DMG','havoc','atk',[1.433]],
  ['1605','1605:8:outro','Soundweaver - Outro Skill DMG','havoc','atk',[1.433]],
  ['1412','1412:8:outro','In This Very Moment - Outro Skill DMG','aero','atk',[7.95]],
  ['1305','1305:8:outro','Chain Rule - Outro Skill DMG','electro','atk',[2.3763]],
  ['1610','1610:8:outro','As the Wind Wills - Outro Skill DMG','havoc','atk',[3]],
  ['1507','1507:8:outro','Beacon For the Future - Outro Skill DMG','spectro','atk',[1.5]]
]

for (const [characterId, id, name, element, scaling, hits] of outros) reviewedAction({
  characterId, id, name, group:'Outro Skill', kind:'damage', damageType:'outro', element,
  formula:{ kind:'damage', scaling:{ [scaling]:1 }, hits, canCrit:true }
})

reviewedAction({
  characterId:'1108', id:'1108:review:glacio-bite', name:'Glacio Bite DMG', group:'Inherent Skill', kind:'damage',
  damageType:'status', element:'glacio', tags:['glacio-chafe'],
  formula:{ kind:'damage', scaling:{ atk:1 }, hits:[1.02], canCrit:true }
})
reviewedAction({
  characterId:'1110', id:'1110:review:springs-birth-healing', name:"Spring's Birth Healing", group:'Inherent Skill', kind:'healing',
  formula:{ kind:'healing', scaling:{ hp:1 }, motionValue:0.0034, flatValue:62 }
})
reviewedAction({
  characterId:'1306', id:'1306:review:glorys-favor-shield', name:"Glory's Favor Shield", group:'Inherent Skill', kind:'shield',
  formula:{ kind:'shield', scaling:{ hp:1 }, motionValue:0.025, flatValue:350 }
})
reviewedAction({
  characterId:'1603', id:'1603:review:twining-ephemeral', name:'Twining Additional DMG after Ephemeral', group:'Outro Skill', kind:'damage',
  damageType:'outro', element:'havoc', formula:{ kind:'damage', scaling:{ atk:1 }, hits:[4.5902], canCrit:true }
})

for (const [characterId, id, name, damageType, element, tags] of [
  ['1206','1206:review:returned-from-ashes','Returned from Ashes','basic','fusion',undefined],
  ['1410','1410:review:arc-beyond-edge','Arc Beyond the Edge','liberation','aero',undefined],
  ['1409','status:aero-erosion','Forced Aero Erosion DMG','status','aero',['aero-erosion']]
] as Array<[string, string, string, CharacterActionMechanics['damageType'], Element, CharacterActionMechanics['tags']]>) reviewedAction({
  characterId, id, name, group:'Reviewed source gap', kind:'damage', damageType, element, tags,
  formula:{ kind:'unsupported', family:'numeric formula is not present in the reviewed source data' }
})

export const supplementalCharacterActions: Readonly<Record<string, Readonly<ActionMap>>> = supplemental

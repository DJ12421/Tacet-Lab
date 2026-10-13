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
  minimumSequence?: number
  cooldownSeconds?: number
  maximumUses?: number
  recipient?: CharacterActionMechanics['recipient']
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
    ...(input.recipient ? { recipient:input.recipient } : {}),
    damageType:input.damageType,
    element:input.element,
    tags:input.tags,
    skillLevelIndex:input.skillLevelIndex ?? 4,
    ...(input.minimumSequence === undefined ? {} : { minimumSequence:input.minimumSequence }),
    ...(input.cooldownSeconds === undefined ? {} : { cooldownSeconds:input.cooldownSeconds }),
    ...(input.maximumUses === undefined ? {} : { maximumUses:input.maximumUses }),
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
  characterId:'1410', id:'1410:review:waxing-ascent-shield', name:'Waxing Ascent Shield', group:'Inherent Skill', kind:'shield', recipient:'self',
  formula:{ kind:'shield', scaling:{ atk:1 }, motionValue:0.32, flatValue:0 }
})
reviewedAction({
  characterId:'1212', id:'1212:review:hark-the-dust-shield', name:'Hark the Dust Shield', group:'Inherent Skill', kind:'shield', recipient:'self',
  formula:{ kind:'shield', scaling:{ hp:1 }, motionValue:0.016, flatValue:700 }
})
reviewedAction({
  characterId:'1212', id:'1212:review:yinghuo-shield', name:'Yinghuo Shield', group:'Inherent Skill', kind:'shield', recipient:'self',
  formula:{ kind:'shield', scaling:{ hp:1 }, motionValue:0.008, flatValue:350 }
})
// shortcut: Grace of Life needs the protected member's fatal-hit event and ten-minute cooldown before it can be automatic.
reviewedAction({
  characterId:'1503', id:'1503:review:grace-of-life-shield', name:'Grace of Life Shield', group:'Inherent Skill', kind:'shield', recipient:'team',
  formula:{ kind:'shield', scaling:{ atk:1 }, motionValue:1.2, flatValue:0 }
})
// shortcut: Boundedness healing follows removal of a per-member protection state; select it manually after that event.
reviewedAction({
  characterId:'1209', id:'1209:review:boundedness-heal', name:'Boundedness Healing', group:'Inherent Skill', kind:'healing', recipient:'team',
  formula:{ kind:'healing', scaling:{ def:1 }, motionValue:1.5, flatValue:0 }
})
// shortcut: the Intro user in Ruler's Realm must be chosen manually until support recipients follow team actions.
reviewedAction({
  characterId:'1306', id:'1306:review:rulers-realm-shield', name:"Ruler's Realm Shield", group:'Forte Circuit', kind:'shield', recipient:'team',
  formula:{ kind:'shield', scaling:{ hp:1 }, motionValue:0.05, flatValue:650 }
})
// shortcut: Antique Appraisal uses Scroll Divination's rank-one healing values; derive all skill ranks from its reviewed healing action when support formulas can reference actions.
reviewedAction({
  characterId:'1106', id:'1106:review:antique-appraisal-heal', name:'Antique Appraisal Team Heal', group:'Inherent Skill', kind:'healing', recipient:'team',
  formula:{ kind:'healing', scaling:{ atk:1 }, motionValue:0.117, flatValue:312.3 }
})
// shortcut: incoming-hit triggers and cooldowns are not tracked; select these S5 shields only after their conditions occur.
reviewedAction({
  characterId:'1210', id:'1210:review:s5-digital-ghost-shield', name:'2D Digital Ghost Team Shield', group:'Sequence 5', kind:'shield', recipient:'team', minimumSequence:5,
  formula:{ kind:'shield', scaling:{ atk:1 }, motionValue:3.6, flatValue:0 }
})
reviewedAction({
  characterId:'1409', id:'1409:review:s5-fatal-blow-shield', name:'Hope Reshaped in Storms Shield', group:'Sequence 5', kind:'shield', recipient:'self', minimumSequence:5,
  formula:{ kind:'shield', scaling:{ hp:1 }, motionValue:0.25, flatValue:0 }
})
reviewedAction({
  characterId:'1511', id:'1511:review:s5-optical-illusion-shield', name:'A Broken Path to Hell Shield', group:'Sequence 5', kind:'shield', recipient:'self', minimumSequence:5,
  formula:{ kind:'shield', scaling:{ atk:1 }, motionValue:1.5, flatValue:0 }
})
reviewedAction({
  characterId:'1306', id:'1306:review:glorys-favor-shield', name:"Glory's Favor Shield", group:'Inherent Skill', kind:'shield',
  formula:{ kind:'shield', scaling:{ hp:1 }, motionValue:0.025, flatValue:350 }
})
reviewedAction({
  characterId:'1603', id:'1603:review:twining-ephemeral', name:'Twining Additional DMG after Ephemeral', group:'Outro Skill', kind:'damage',
  damageType:'outro', element:'havoc', formula:{ kind:'damage', scaling:{ atk:1 }, hits:[4.5902], canCrit:true }
})

// shortcut: Brant's local source only has manually transcribed rank-one formulas here; add reviewed level curves when skill-level parity is required.
reviewedAction({
  characterId:'1206', id:'1206:review:returned-from-ashes', name:'Returned from Ashes', group:'Forte Circuit', kind:'damage',
  damageType:'basic', element:'fusion', formula:{ kind:'damage', scaling:{ atk:1 }, hits:[0.2375,0.2375,0.475,0.95,0.95,6.65], canCrit:true }
})
reviewedAction({
  characterId:'1206', id:'1206:review:returned-from-ashes-shield', name:'Returned from Ashes Shield', group:'Forte Circuit', kind:'shield',
  formula:{ kind:'shield', scaling:{ energyRegen:1 }, motionValue:900, flatValue:2500 }
})
// shortcut: insert after an incoming teammate's Skill during Brant's Outro window; the two-blast cap needs linked rotation state.
reviewedAction({
  characterId:'1206', id:'1206:review:s2-outro-blast', name:'For Smiles and Cheers Blast', group:'Sequence 2', kind:'damage', minimumSequence:2, cooldownSeconds:1, maximumUses:2,
  damageType:'basic', element:'fusion', formula:{ kind:'damage', scaling:{ atk:1 }, hits:[4.4], canCrit:true }
})
reviewedAction({
  characterId:'1508', id:'1508:review:s1-unseen-snare-hit', name:'Wandering Through the Desolate Corridors Hit', group:'Sequence 1', kind:'damage', minimumSequence:1,
  damageType:'basic', element:'havoc', formula:{ kind:'unsupported', family:'fixed 61803 hit requires target HP, a 61.8% HP floor, and once-per-target state' }
})

for (const [id, name, group, sequence, coefficient] of [
  ['1411:review:straw-cape-in-drizzly-rain', 'Straw Cape in Drizzly Rain', 'Resonance Skill', 3, 5],
  ['1411:review:sheath-fallen-new-shoots', 'Sheath Fallen, New Shoots Revealed', 'Outro Skill', 3, 5],
  ['1411:review:exit-inksplash-of-mind', 'Exit Inksplash of Mind', 'Sequence 6', 6, 6]
] as Array<[string, string, string, number, number]>) reviewedAction({
  characterId:'1411', id, name, group, kind:'damage', minimumSequence:sequence,
  damageType:'echo', element:'aero', formula:{ kind:'damage', scaling:{ atk:1 }, hits:[coefficient], canCrit:true }
})

for (const [characterId, id, name, damageType, element, tags] of [
  ['1410','1410:review:arc-beyond-edge','Arc Beyond the Edge','liberation','aero',undefined],
  ['1409','status:aero-erosion','Forced Aero Erosion DMG','status','aero',['aero-erosion']]
] as Array<[string, string, string, CharacterActionMechanics['damageType'], Element, CharacterActionMechanics['tags']]>) reviewedAction({
  characterId, id, name, group:'Reviewed source gap', kind:'damage', damageType, element, tags,
  formula:{ kind:'unsupported', family:'numeric formula is not present in the reviewed source data' }
})

export const supplementalCharacterActions: Readonly<Record<string, Readonly<ActionMap>>> = supplemental

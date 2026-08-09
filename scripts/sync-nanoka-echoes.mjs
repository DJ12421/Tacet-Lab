import { writeFile } from 'node:fs/promises'
const version='3.5',base=`https://static.nanoka.cc/ww/${version}`
const encoreBase='https://api-v2.encore.moe/api/en'
const wutheringToolsHome='https://www.wutheringtools.com/'
const sources={characters:`${base}/character.json`,weapons:`${base}/weapon.json`,echoes:`${base}/echo.json`,titles:`${encoreBase}/title`,damageTypes:wutheringToolsHome}
const names=['','Freezing Frost','Molten Rift','Void Thunder','Sierra Gale','Celestial Light','Havoc Eclipse','Rejuvenating Glow','Moonlit Clouds','Lingering Tunes','Frosty Resolve','Eternal Radiance','Midnight Veil','Empyrean Anthem','Tidebreaking Courage',,'Gusts of Welkin','Windward Pilgrimage','Flaming Clawprint','Dream of the Lost','Crown of Valor','Law of Harmony',"Flamewing's Shadow",'Thread of Severed Fate','Pact of Neonlight Leap','Halo of Starry Radiance','Rite of Gilded Revelation','Trailblazing Star','Chromatic Foam','Sound of True Name','Wishes of Quiet Snowfall','Reel of Spliced Memories','Shadow of Shattered Dreams','Song of Feathered Trace',"Heart of Evil's Purge",'Lamp of Nether Road']
const load=async source=>{const response=await fetch(source);if(!response.ok)throw Error(`Nanoka ${response.status}: ${source}`);return response.json()}
const loadText=async source=>{const response=await fetch(source);if(!response.ok)throw Error(`Source ${response.status}: ${source}`);return response.text()}
const mapLimit=async(items,limit,mapper)=>{
  const output=new Array(items.length)
  let cursor=0
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(cursor<items.length){const index=cursor++;output[index]=await mapper(items[index],index)}
  }))
  return output
}
const [rawCharacters,rawWeapons,rawEchoes,rawTitles]=await Promise.all([sources.characters,sources.weapons,sources.echoes,sources.titles].map(load))
const normalizedSourceKey=value=>String(value??'').normalize('NFKD').replace(/[^a-z0-9]+/gi,'').toLowerCase()
const wutheringToolsTypeMap={
  Basic:'basic',
  Heavy:'heavy',
  Skill:'skill',
  Liberation:'liberation',
  Intro:'intro',
  Outro:'outro',
  Healing:'healing'
}
const loadWutheringToolsDamageTypes=async characterNames=>{
  const page=await loadText(wutheringToolsHome)
  const mainAsset=page.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/i)?.[1]
  if(!mainAsset)throw Error('Missing WutheringTools application bundle')
  const mainBundle=await loadText(new URL(mainAsset,wutheringToolsHome))
  const expectedKeys=[...new Set(characterNames.map(normalizedSourceKey))]
  const chunkByCharacter=new Map([...mainBundle.matchAll(/"\.\/([^/"]+)\/index\.ts":[^"]+import\("\.\/([^"]+\.js)"\)/g)]
    .map(([,characterKey,chunk])=>({characterKey,chunk}))
    .filter(({characterKey})=>{
      const normalizedKey=normalizedSourceKey(characterKey)
      return expectedKeys.some(expected=>normalizedKey===expected||normalizedKey.startsWith(expected))
    }).map(entry=>[normalizedSourceKey(entry.characterKey),entry]))
  const chunks=[...chunkByCharacter.values()]
  if(chunks.length<characterNames.length)throw Error(`Incomplete WutheringTools character modules: ${chunks.length}/${characterNames.length}`)
  const entries=await mapLimit(chunks,8,async({characterKey,chunk})=>{
    const moduleSource=await loadText(new URL(`assets/${chunk}`,wutheringToolsHome))
    const types=new Map()
    for(const match of moduleSource.matchAll(/label:("(?:\\.|[^"\\])*")[\s\S]{0,2000}?type:"(Basic|Heavy|Skill|Liberation|Intro|Outro|Healing|TuneBreak)"/g)){
      const label=JSON.parse(match[1])
      const type=wutheringToolsTypeMap[match[2]]
      if(!type)continue
      const key=normalizedSourceKey(label)
      if(!types.has(key))types.set(key,new Set())
      types.get(key).add(type)
    }
    return [normalizedSourceKey(characterKey),types]
  })
  const emptyCharacters=entries.filter(([,types])=>types.size===0).map(([characterKey])=>characterKey)
  if(emptyCharacters.length)throw Error(`Missing WutheringTools attack types: ${emptyCharacters.join(', ')}`)
  return new Map(entries)
}
const wutheringToolsDamageTypes=await loadWutheringToolsDamageTypes(Object.values(rawCharacters).map(character=>character.en))
const wutheringToolsSourceTypeCount=[...wutheringToolsDamageTypes.values()].reduce((total,types)=>total+types.size,0)
let wutheringToolsTypeMatches=0,wutheringToolsTypeMisses=0
const wutheringToolsCombatType=(characterKey,attackName)=>{
  const characterTypes=wutheringToolsDamageTypes.get(normalizedSourceKey(characterKey))
  const normalizedName=normalizedSourceKey(attackName)
  const exact=characterTypes?.get(normalizedName)
  if(exact?.size===1){
    wutheringToolsTypeMatches++
    return [...exact][0]
  }
  const suffixMatches=[...(characterTypes??[])].filter(([label])=>label.length>=6&&(normalizedName.endsWith(label)||label.endsWith(normalizedName)))
  const suffixTypes=new Set(suffixMatches.flatMap(([,types])=>[...types]))
  if(suffixTypes.size===1){
    wutheringToolsTypeMatches++
    return [...suffixTypes][0]
  }
  wutheringToolsTypeMisses++
  return undefined
}
const formatEffect=(desc='',param=[])=>desc.replace(/\{(\d+)\}/g,(_,index)=>param[Number(index)]??`{${index}}`)
const asset=p=>`https://static.nanoka.cc/assets/ww/${p.replace(/^\/Game\/Aki\/UI\//,'').split('.')[0]}.webp`
const spineAsset=path=>{
  const match=String(path??'').match(/\/Portraits\/([^/]+)\/([^/.]+)/i)
  return match?`https://static.nanoka.cc/assets/ww/portraits/${match[1]}/${match[2]}`:''
}
const sonataIconFallbackBase='https://wuthering.gg/images/iconelement'
const sonataAsset=async path=>{
  const primary=asset(path)
  if((await fetch(primary,{method:'HEAD'})).ok)return primary
  const filename=path.split('/').at(-1)?.split('.')[0]
  const fallback=`${sonataIconFallbackBase}/${filename}.png`
  if((await fetch(fallback,{method:'HEAD'})).ok)return fallback
  throw Error(`Missing Sonata icon: ${path}`)
}
const elements=['','Glacio','Fusion','Electro','Aero','Spectro','Havoc']
const weaponTypes=['','Broadblade','Sword','Pistols','Gauntlets','Rectifier']
const characterDetails=await mapLimit(Object.keys(rawCharacters),8,async id=>[id,await load(`${base}/en/character/${id}.json`)])
const characterDetailById=new Map(characterDetails)
const titleDetails=await mapLimit(rawTitles.titleList??[],8,title=>load(`${encoreBase}/title/${title.Id}`))
const rawTitleAssetBase='https://raw.githubusercontent.com/alt3ri/WW_Asset/Global/UIResources/Common/Image/Com/Image'
const titleCardAsset=image=>{
  if(!image)return ''
  const filename=image.split('/').at(-1)?.replace(/\.webp$/i,'.png')??''
  const roleNumber=Number(filename.match(/EpithetName_Role_(\d+)/i)?.[1]??0)
  return roleNumber>0&&roleNumber<=46?`${rawTitleAssetBase}/${filename}`:image.replace(/\.png$/i,'.webp')
}
const titleCardByCharacter=new Map(titleDetails.flatMap(title=>{
  const owner=title.HonorDescription?.match(/^Fully activate (.+?)(?:'s|’s) Resonance Chain$/i)?.[1]
  return owner&&title.Image?[[owner,titleCardAsset(title.Image)]]:[]
}))
const combatType=(skillType,name='')=>{
  if(/Outro Skill DMG/i.test(name))return 'outro'
  if(skillType==='Outro Skill')return 'outro'
  if(skillType==='Intro Skill')return 'intro'
  if(/Heavy Attack/i.test(name))return 'heavy'
  if(skillType==='Normal Attack')return 'basic'
  if(skillType==='Resonance Liberation')return 'liberation'
  return 'skill'
}
const skillLevelIndex=skillType=>skillType==='Normal Attack'?0:skillType==='Resonance Skill'?1:skillType==='Forte Circuit'?2:skillType==='Resonance Liberation'?3:skillType==='Intro Skill'?4:1
const fixedSkillValuePattern=/\b(?:sta(?:mina)?\s+cost|concerto\s+(?:regen|regeneration|recovery)|cooldown|duration|resonance(?:\s+energy)?\s+cost)\b/i
const fixedSkillValues=(skill,nodeId)=>Object.entries(skill.level??{}).flatMap(([lineId,line])=>{
  const name=line?.name?`${skill.name} - ${line.name}`:skill.name
  if(!fixedSkillValuePattern.test(name))return []
  const parameters=Array.isArray(line.param)?line.param:[]
  const levelCount=Math.max(1,...parameters.map(values=>Array.isArray(values)?values.length:0))
  const values=Array.from({length:levelCount},(_,levelIndex)=>{
    const levelParams=parameters.map(values=>Array.isArray(values)?values[levelIndex]??values[0]??'':values)
    return line.format?formatEffect(line.format,levelParams):String(levelParams[0]??'')
  })
  return [{id:`${nodeId}-${lineId}`,name,skillLevelIndex:skillLevelIndex(skill.type),values}]
})
const percentageComponents=value=>[...String(value??'').matchAll(/(-?\d+(?:\.\d+)?)%\s*(?:[*×x]\s*(\d+))?/gi)].map(match=>({
  value:Number(match[1]),
  hits:Math.max(1,Number(match[2]??1))
}))
const percentageTerms=value=>percentageComponents(value).flatMap(component=>Array(component.hits).fill(component.value))
const damageLineExpression=(line,levelIndex)=>{
  const parameters=Array.isArray(line?.param)?line.param:[]
  const levelParams=parameters.map(values=>Array.isArray(values)?values[levelIndex]??values[0]??'':values)
  return line?.format?formatEffect(line.format,levelParams):String(levelParams[0]??'')
}
const damageLineHitMultipliers=line=>{
  const parameters=Array.isArray(line?.param)?line.param:[]
  const levelCount=Math.max(1,...parameters.map(values=>Array.isArray(values)?values.length:0))
  const termsByLevel=Array.from({length:levelCount},(_,levelIndex)=>percentageTerms(damageLineExpression(line,levelIndex)))
  const hitCount=Math.max(0,...termsByLevel.map(terms=>terms.length))
  return Array.from({length:hitCount},(_,hitIndex)=>termsByLevel.map(terms=>(terms[hitIndex]??0)/100))
}
const damageComponentHitMultipliers=components=>components.map(component=>(component.rate_lv??[]).map(value=>Number(value)/10000))
const damageLineValues=hitMultipliers=>{
  return hitMultipliers[0]?.map((_,levelIndex)=>hitMultipliers.reduce((total,hit)=>total+(hit[levelIndex]??0),0))??[]
}
const outroDescriptionAttack=(id,nodeId,skill)=>{
  const description=formatEffect(skill?.desc,skill?.param).replace(/<[^>]+>/g,'')
  const damageSentence=description.split(/(?<=[.!?])\s+|\n+/).find(sentence=>
    /\b(?:deal(?:s|ing)?|suffering)\b/i.test(sentence)
    && /\b(?:Aero|Electro|Fusion|Glacio|Havoc|Spectro)\s+DMG\b/i.test(sentence)
    && percentageComponents(sentence).length
  )
  if(!damageSentence)return []
  const hitMultipliers=percentageTerms(damageSentence).map(value=>[value/100])
  const multipliers=damageLineValues(hitMultipliers)
  const scalesWith=/\bDEF\b/i.test(damageSentence)?'def':/\b(?:max\s+)?HP\b/i.test(damageSentence)?'hp':'atk'
  return [{
    id:`${id}-${nodeId}-outro`,
    name:`${skill.name} - Outro Skill DMG`,
    type:'outro',
    skillLevelIndex:skillLevelIndex(skill.type),
    scalesWith,
    multipliers,
    hitMultipliers
  }]
}
// Nanoka 3.5 formats this as 6.11% × 6 + 24.44%, but the two damage
// components and the English in-game damage breakdown both show two hits.
const verifiedComponentHitAttacks=new Set(['1511:1:Basic Attack Stage 1 DMG'])
const characterLevels=Array.from({length:90},(_,index)=>index+1)
const characterStatsAtLevel=(detail,level)=>{
  const candidates=Object.entries(detail?.stats??{}).flatMap(([ascension,levels])=>levels[String(level)]?[{ascension:Number(ascension),stats:levels[String(level)]}]:[]).sort((a,b)=>b.ascension-a.ascension)
  const stats=candidates[0]?.stats??{}
  return {level,hp:Number(stats.life??0),atk:Number(stats.atk??0),def:Number(stats.def??0)}
}
const showcaseSkillTypes={
  normalAttack:'Normal Attack',
  resonanceSkill:'Resonance Skill',
  forteCircuit:'Forte Circuit',
  resonanceLiberation:'Resonance Liberation',
  introSkill:'Intro Skill'
}
const characters=Object.entries(rawCharacters).map(([id,c])=>{
  const detail=characterDetailById.get(id)
  const rawGender=String(detail?.chara_info?.sex??'').toLowerCase()
  const gender=rawGender==='male'||rawGender==='female'?rawGender:null
  const wutheringToolsCharacterKey=/^Rover\b/i.test(c.en)?`${c.en} ${gender??''}`:c.en
  const levelStats=characterLevels.map(level=>characterStatsAtLevel(detail,level))
  const maxStats=levelStats.at(-1)??{hp:0,atk:0,def:0}
  const skillEntries=Object.entries(detail?.skill_trees??{})
  const skills=skillEntries.map(([,node])=>node.skill??node)
  const skillAsset=(skill,fallback='')=>({name:skill?.name??fallback,description:formatEffect(skill?.desc,skill?.param),iconSourceUrl:skill?.icon?asset(skill.icon):''})
  const skillIcons=Object.fromEntries(Object.entries(showcaseSkillTypes).map(([key,type])=>{
    const skill=skills.find(candidate=>candidate.type===type)
    return [key,skillAsset(skill,type)]
  }))
  const bonusStatBranches=Object.fromEntries(Object.entries(showcaseSkillTypes).map(([key,type])=>{
    const mainEntry=skillEntries.find(([,node])=>(node.skill??node).type===type)
    let parentId=mainEntry?.[0],branch=[]
    for(let coordinate=1;coordinate<=2&&parentId;coordinate++){
      const next=skillEntries.find(([,node])=>!(node.skill??node).type&&node.coordinate===coordinate&&(node.parent_nodes??[]).map(String).includes(String(parentId)))
      if(!next)break
      branch.push(skillAsset(next[1].skill??next[1]))
      parentId=next[0]
    }
    return [key,branch]
  }))
  const skillTreeExtras={
    outroSkill:skillAsset(skills.find(candidate=>candidate.type==='Outro Skill')),
    inherentSkills:skills.filter(candidate=>candidate.type==='Inherent Skill').map(skillAsset),
    bonusStatBranches,
    tuneBreakSkill:skillAsset(skills.find(candidate=>candidate.type==='Tune Break'))
  }
  const sequenceIcons=Object.entries(detail?.chains??{}).sort(([left],[right])=>Number(left)-Number(right)).map(([sequence,chain])=>({sequence:Number(sequence),name:chain.name??`Sequence ${sequence}`,description:formatEffect(chain.desc,chain.param),iconSourceUrl:chain.icon?asset(chain.icon):''}))
  const flatSkillValues=Object.entries(detail?.skill_trees??{}).flatMap(([nodeId,node])=>fixedSkillValues(node.skill??node,nodeId))
  const attacks=Object.entries(detail?.skill_trees??{}).flatMap(([nodeId,node])=>{
    const skill=node.skill??node
    const damageEntries=Object.values(skill.damage??{})
    let damageCursor=0,attackIndex=0
    return Object.values(skill.level??{}).flatMap(line=>{
      const componentCount=Math.max(1,percentageComponents(damageLineExpression(line,0)).length)
      const components=damageEntries.slice(damageCursor,damageCursor+componentCount)
      damageCursor+=componentCount
      const attackKey=`${id}:${nodeId}:${line?.name??''}`
      const hitMultipliers=verifiedComponentHitAttacks.has(attackKey)?damageComponentHitMultipliers(components):damageLineHitMultipliers(line)
      const multipliers=damageLineValues(hitMultipliers)
      if(!multipliers.length||multipliers.some(value=>value===undefined))return []
      const damage=components[0]
      if(!damage||!['ATK','HP','DEF'].includes(damage.related_property))return []
      const name=line?.name?`${skill.name} - ${line.name}`:skill.name
      if(fixedSkillValuePattern.test(name))return []
      const isHealing=components.length>0&&components.every(component=>Number(component.element)===0)
      const importedType=wutheringToolsCombatType(wutheringToolsCharacterKey,name)
      const type=isHealing?'healing':importedType??combatType(skill.type,name)
      return [{id:`${id}-${nodeId}-${attackIndex++}`,name,type,skillLevelIndex:skillLevelIndex(skill.type),scalesWith:damage.related_property.toLowerCase(),multipliers,hitMultipliers}]
    })
  })
  const outroEntry=skillEntries.find(([,node])=>(node.skill??node).type==='Outro Skill')
  if(!attacks.some(attack=>attack.type==='outro')&&outroEntry){
    attacks.push(...outroDescriptionAttack(id,outroEntry[0],outroEntry[1].skill??outroEntry[1]))
  }
  const animatedSkin=Object.values(detail?.skin??{}).find(skin=>skin.formation_spine_skel&&skin.formation_spine_atlas)
  const spineBaseUrl=spineAsset(animatedSkin?.formation_spine_skel)
  return {id,name:c.en,title:detail?.chara_info?.talent_name??c.nickname??c.en,nickname:c.nickname,description:c.desc.replace(/<[^>]+>/g,''),rarity:c.rank,element:elements[c.element]??'Unknown',weaponType:weaponTypes[c.weapon]??'Unknown',role:Object.values(detail?.tag??{})[0]?.name??'Resonator',gender,baseStats:{hp:maxStats.hp,atk:maxStats.atk,def:maxStats.def,critRate:5,critDamage:150},levelStats,skillIcons,skillTreeExtras,sequenceIcons,flatSkillValues,attacks,articleUrl:`https://ww.nanoka.cc/character/${id}`,iconSourceUrl:asset(c.icon),portraitSourceUrl:asset(detail?.background??detail?.background_stand??c.icon),titleCardSourceUrl:titleCardByCharacter.get(c.en)??'',spineSkeletonSourceUrl:spineBaseUrl?`${spineBaseUrl}.skel`:'',spineAtlasSourceUrl:spineBaseUrl?`${spineBaseUrl}.atlas`:''}
}).sort((a,b)=>a.name.localeCompare(b.name))
const weaponEntries=Object.entries(rawWeapons).filter(([,weapon])=>!/^Projection(?:\s*[-:]|\b)/i.test(weapon.en))
const weaponDetails=await mapLimit(weaponEntries.map(([id])=>id),8,async id=>[id,await load(`${base}/en/weapon/${id}.json`)])
const weaponDetailById=new Map(weaponDetails)
const weaponLevels=[1,10,20,30,40,50,60,70,80,90]
const floorWeaponAtk=value=>Math.floor(Number(value??0)+Number.EPSILON*100)
const floorWeaponStat=value=>Math.floor(Number(value??0)*10+Number.EPSILON*100)/10
const formatWeaponStat=stat=>{
  if(!stat)return ''
  const value=stat.is_percent?stat.value/100:stat.is_ratio?stat.value*100:stat.value
  return `${floorWeaponStat(value).toFixed(1).replace(/\.0$/,'')}${stat.is_percent||stat.is_ratio?'%':''}`
}
const weapons=weaponEntries.map(([id,w])=>{
  const detail=weaponDetailById.get(id),maxStats=detail?.stats?.['6']?.['90']??[]
  const secondary=maxStats[1]
  const levelStats=weaponLevels.map(level=>{
    const candidates=Object.entries(detail?.stats??{}).flatMap(([ascension,levels])=>levels[String(level)]?[{ascension:Number(ascension),stats:levels[String(level)]}]:[]).sort((a,b)=>b.ascension-a.ascension)
    const stats=candidates[0]?.stats??[]
    return {level,baseAtk:floorWeaponAtk(stats[0]?.value),secondaryStatValue:formatWeaponStat(stats[1])}
  })
  const passiveEffects=Array.from({length:5},(_,rank)=>formatEffect(detail?.effect,(detail?.param??[]).map(values=>values[rank])))
  return {id,name:w.en,description:w.desc,rarity:w.rank,type:weaponTypes[w.type]??'Unknown',baseAtk:floorWeaponAtk(maxStats[0]?.value??w.atk),secondaryStat:w.sub??secondary?.name??'Unreleased',secondaryStatValue:formatWeaponStat(secondary),levelStats,passiveName:detail?.effect_name??'',passiveEffects,articleUrl:`https://ww.nanoka.cc/weapon/${id}`,iconSourceUrl:asset(w.icon)}
}).sort((a,b)=>a.name.localeCompare(b.name))
// Corrections verified from user-provided in-game catalog evidence but not yet reflected in Nanoka.
const additionalEchoSonataGroups={6000085:[1,2,3,4,5,6]}
const echoes=Object.entries(rawEchoes).map(([id,e])=>({id,name:e.en,cost:e.intensity===0?1:e.intensity===1?3:4,sonatas:[...new Set([...e.group,...(additionalEchoSonataGroups[id]??[])])].map(g=>names[g]),rarities:e.rank,intensity:e.intensity,articleUrl:`https://ww.nanoka.cc/echo/${id}`,iconPath:e.icon,iconSourceUrl:asset(e.icon)})).sort((a,b)=>a.name.localeCompare(b.name))
if(echoes.length<170||echoes.some(e=>e.sonatas.includes(undefined)))throw Error('Incomplete Nanoka data')
const representativeEchoByGroup=new Map()
for(const [echoId,echo] of Object.entries(rawEchoes))for(const groupId of echo.group)if(!representativeEchoByGroup.has(groupId))representativeEchoByGroup.set(groupId,echoId)
const groupDetails=await Promise.all([...representativeEchoByGroup.entries()].map(async([groupId,echoId])=>{const detail=await load(`${base}/en/echo/${echoId}.json`);return [groupId,detail.group?.[groupId]]}))
const groupById=new Map(groupDetails)
const sonatas=names.flatMap((name,id)=>name?[{id:String(id),name,echoCount:echoes.filter(e=>e.sonatas.includes(name)).length,effects:Object.entries(groupById.get(id)?.set??{}).map(([pieces,effect])=>({pieces:Number(pieces),description:formatEffect(effect.desc,effect.param)})).sort((a,b)=>a.pieces-b.pieces)}]:[])
const sonataIconSources=Object.fromEntries(await mapLimit(sonatas,8,async sonata=>{
  const icon=groupById.get(Number(sonata.id))?.icon
  return [sonata.name,icon?await sonataAsset(icon):'']
}))
if(characters.length<50||weapons.length<100||sonatas.length<30)throw Error('Incomplete Nanoka catalogs')
const generatedAt=new Date().toISOString()
const header='// Generated by scripts/sync-nanoka-echoes.mjs. Do not edit.\n'
const types=`${header}export interface GeneratedCharacterAttackEntry {id:string;name:string;type:'basic'|'heavy'|'skill'|'liberation'|'intro'|'outro'|'healing';skillLevelIndex:number;scalesWith:'atk'|'hp'|'def';multipliers:number[];hitMultipliers:number[][]}
export interface GeneratedCharacterFlatSkillValueEntry {id:string;name:string;skillLevelIndex:number;values:string[]}
export interface GeneratedCharacterLevelStats {level:number;hp:number;atk:number;def:number}
export interface GeneratedCharacterSkillAsset {name:string;description:string;iconSourceUrl:string}
export interface GeneratedCharacterSequenceAsset {sequence:number;name:string;description:string;iconSourceUrl:string}
export interface GeneratedCharacterCatalogEntry {id:string;name:string;title:string;nickname:string;description:string;rarity:number;element:string;weaponType:string;role:string;gender:'male'|'female'|null;baseStats:{hp:number;atk:number;def:number;critRate:number;critDamage:number};levelStats:GeneratedCharacterLevelStats[];skillIcons:{normalAttack:GeneratedCharacterSkillAsset;resonanceSkill:GeneratedCharacterSkillAsset;forteCircuit:GeneratedCharacterSkillAsset;resonanceLiberation:GeneratedCharacterSkillAsset;introSkill:GeneratedCharacterSkillAsset};skillTreeExtras:{outroSkill:GeneratedCharacterSkillAsset;inherentSkills:GeneratedCharacterSkillAsset[];bonusStatBranches:{normalAttack:GeneratedCharacterSkillAsset[];resonanceSkill:GeneratedCharacterSkillAsset[];forteCircuit:GeneratedCharacterSkillAsset[];resonanceLiberation:GeneratedCharacterSkillAsset[];introSkill:GeneratedCharacterSkillAsset[]};tuneBreakSkill:GeneratedCharacterSkillAsset};sequenceIcons:GeneratedCharacterSequenceAsset[];flatSkillValues:GeneratedCharacterFlatSkillValueEntry[];attacks:GeneratedCharacterAttackEntry[];articleUrl:string;iconSourceUrl:string;portraitSourceUrl:string;titleCardSourceUrl:string;spineSkeletonSourceUrl:string;spineAtlasSourceUrl:string}
export interface GeneratedCharacterSummary {id:string;name:string;title:string;nickname:string;rarity:number;element:string;weaponType:string;role:string;gender:'male'|'female'|null;articleUrl:string;iconSourceUrl:string;portraitSourceUrl:string}
export interface GeneratedWeaponLevelStats {level:number;baseAtk:number;secondaryStatValue:string}
export interface GeneratedWeaponCatalogEntry {id:string;name:string;description:string;rarity:number;type:string;baseAtk:number;secondaryStat:string;secondaryStatValue:string;levelStats:GeneratedWeaponLevelStats[];passiveName:string;passiveEffects:string[];articleUrl:string;iconSourceUrl:string}
export interface GeneratedWeaponSummary {id:string;name:string;rarity:number;type:string;baseAtk:number;secondaryStat:string;secondaryStatValue:string;articleUrl:string;iconSourceUrl:string}
export interface GeneratedSonataCatalogEntry {id:string;name:string;echoCount:number;effects:Array<{pieces:number;description:string}>}
export interface GeneratedEchoCatalogEntry {id:string;name:string;cost:1|3|4;sonatas:string[];rarities:number[];intensity:number;articleUrl:string;iconPath:string;iconSourceUrl:string}
`
const characterSummaries=characters.map(({id,name,title,nickname,rarity,element,weaponType,role,gender,articleUrl,iconSourceUrl,portraitSourceUrl})=>({id,name,title,nickname,rarity,element,weaponType,role,gender,articleUrl,iconSourceUrl,portraitSourceUrl}))
const weaponSummaries=weapons.map(({id,name,rarity,type,baseAtk,secondaryStat,secondaryStatValue,articleUrl,iconSourceUrl})=>({id,name,rarity,type,baseAtk,secondaryStat,secondaryStatValue,articleUrl,iconSourceUrl}))
await Promise.all([
  writeFile('src/game-data/catalog-types.generated.ts',types),
  writeFile('src/game-data/characters.generated.ts',`${header}import type { GeneratedCharacterCatalogEntry } from './catalog-types.generated'\nexport const generatedCharacterCatalog:GeneratedCharacterCatalogEntry[]=${JSON.stringify(characters,null,2)}\n`),
  writeFile('src/game-data/character-summaries.generated.ts',`${header}import type { GeneratedCharacterSummary } from './catalog-types.generated'\nexport const generatedCharacterSummaries:GeneratedCharacterSummary[]=${JSON.stringify(characterSummaries,null,2)}\n`),
  writeFile('src/game-data/weapons.generated.ts',`${header}import type { GeneratedWeaponCatalogEntry } from './catalog-types.generated'\nexport const generatedWeaponCatalog:GeneratedWeaponCatalogEntry[]=${JSON.stringify(weapons,null,2)}\n`),
  writeFile('src/game-data/weapon-summaries.generated.ts',`${header}import type { GeneratedWeaponSummary } from './catalog-types.generated'\nexport const generatedWeaponSummaries:GeneratedWeaponSummary[]=${JSON.stringify(weaponSummaries,null,2)}\n`),
  writeFile('src/game-data/sonatas.generated.ts',`${header}import type { GeneratedSonataCatalogEntry } from './catalog-types.generated'\nexport const generatedSonataCatalog:GeneratedSonataCatalogEntry[]=${JSON.stringify(sonatas,null,2)}\nexport const generatedSonataIconSources:Record<string,string>=${JSON.stringify(sonataIconSources,null,2)}\n`),
  writeFile('src/game-data/echoes.generated.ts',`${header}import type { GeneratedEchoCatalogEntry } from './catalog-types.generated'\nexport type { GeneratedEchoCatalogEntry }\nexport { catalogProvenance as echoCatalogProvenance } from './catalog-provenance.generated'\nexport const generatedEchoCatalog:GeneratedEchoCatalogEntry[]=${JSON.stringify(echoes,null,2)}\n`),
  writeFile('src/game-data/catalog-provenance.generated.ts',`${header}export const catalogProvenance=${JSON.stringify({sources,dataVersion:version,generatedAt})} as const\n`),
  writeFile('src/game-data/catalog.generated.ts',`${header}export * from './catalog-types.generated'\nexport { generatedCharacterCatalog } from './characters.generated'\nexport { generatedCharacterSummaries } from './character-summaries.generated'\nexport { generatedWeaponCatalog } from './weapons.generated'\nexport { generatedWeaponSummaries } from './weapon-summaries.generated'\nexport { generatedSonataCatalog, generatedSonataIconSources } from './sonatas.generated'\nexport { generatedEchoCatalog } from './echoes.generated'\nexport { catalogProvenance } from './catalog-provenance.generated'\n`)
])
console.log(`Wrote ${characters.length} characters, ${weapons.length} weapons, ${sonatas.length} Sonatas, and ${echoes.length} Echoes from Nanoka ${version}`)
console.log(`Imported ${wutheringToolsTypeMatches}/${wutheringToolsSourceTypeCount} matching attack damage types from WutheringTools; ${wutheringToolsTypeMisses} Nanoka-only or ambiguous attacks retained their category fallback`)

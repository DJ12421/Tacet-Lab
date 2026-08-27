import type { CSSProperties } from 'react'
import { emptyCalculationScenarioV2, type CalculationEffectDefinition } from '../../domain/calculation-v2'
import { createLocalId } from '../../domain/id'
import type { BuffEffect, Team } from '../../domain/types'
import { Icon } from '../components'
import type { TeamMemberModel, TeamWorkspaceModel } from '../team-workspace-model'
import { CalculationEffectControls, CalculationStanceControl } from './BuffEffectControls'

const ELEMENT_COLORS: Record<string, string> = {
  Aero:'#73d9c6', Electro:'#a98bf5', Fusion:'#ef7662', Glacio:'#78bde8', Havoc:'#c06ddb', Spectro:'#e6c96b'
}
const CATEGORIES = ['Forte', 'Weapon', 'Sonata', 'Echo', 'Sequence', 'Team'] as const
const memberName = (member: TeamMemberModel) => member.catalog?.name ?? member.build?.name ?? `Member ${member.slot + 1}`

function buffCategory(effect: CalculationEffectDefinition) {
  const sourceKind = effect.originSourceKind ?? effect.sourceKind
  if (sourceKind === 'weapon') return 'Weapon'
  if (sourceKind === 'sonata') return 'Sonata'
  if (sourceKind === 'echo') return 'Echo'
  if (sourceKind === 'sequence') return 'Sequence'
  if (sourceKind === 'character' || sourceKind === 'inherent') return 'Forte'
  return 'Team'
}

function ManualBuffs({ model, updateTeam }: Props) {
  const buffs = model.team.buffs ?? []
  const updateBuff = (id: string, patch: Partial<BuffEffect>) => updateTeam({ buffs:buffs.map((buff) => buff.id === id ? { ...buff, ...patch } : buff) })
  const addBuff = async () => {
    const member = model.members.find((entry) => entry.build && entry.attacks.length)
    const attack = member?.attacks[0]
    if (!member?.build || !attack) return
    await updateTeam({ buffs:[...buffs, { id:createLocalId(), name:'Team buff', sourceBuildId:member.build.id, target:'team', triggerAttackId:attack.id, duration:10, stat:'atkPercent', value:10, stackingGroup:createLocalId() }] })
  }
  return <details className="tw-panel tw-buff-workspace tw-advanced-modifiers">
    <summary><span><small>Advanced scenario tools</small><strong>Manual buffs and amplification</strong></span><b>{buffs.length} authored</b><i aria-hidden="true">⌄</i></summary>
    <div className="tw-advanced-modifiers-body"><header><div><span className="eyebrow">Advanced custom modifiers</span><h2>Manual buffs and amplification</h2><p>Built-in Calculation V2 effects are controlled beside their source. Add a row here only when you need to model a custom scenario that is not covered by the imported mechanics.</p></div><button className="secondary" onClick={() => void addBuff()} disabled={!model.members.some((member) => member.build && member.attacks.length)}><Icon name="plus"/>Add modifier</button></header>
    <div className="tw-buff-list">{buffs.map((buff) => {
      const source = model.members.find((member) => member.build?.id === buff.sourceBuildId)
      return <div className="tw-buff-row" key={buff.id}>
        <label><span>Name</span><input value={buff.name} onChange={(event) => void updateBuff(buff.id, { name:event.target.value })}/></label>
        <label><span>Source</span><select value={buff.sourceBuildId} onChange={(event) => { const member = model.members.find((entry) => entry.build?.id === event.target.value); void updateBuff(buff.id, { sourceBuildId:event.target.value, triggerAttackId:member?.attacks[0]?.id ?? '' }) }}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{memberName(member)}</option>] : [])}</select></label>
        <label><span>Trigger</span><select value={buff.triggerAttackId} onChange={(event) => void updateBuff(buff.id, { triggerAttackId:event.target.value })}>{(source?.attacks ?? []).map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</select></label>
        <label><span>Target</span><select value={buff.target} onChange={(event) => { const target = event.target.value as BuffEffect['target']; void updateBuff(buff.id, { target, recipientBuildId:target === 'character' ? buff.recipientBuildId ?? model.members.find((entry) => entry.build)?.build?.id : undefined }) }}><option value="self">Source character</option><option value="next">Next character</option><option value="character">Specific character</option><option value="team">Whole team</option></select></label>
        {buff.target === 'character' && <label><span>Recipient</span><select value={buff.recipientBuildId ?? ''} onChange={(event) => void updateBuff(buff.id, { recipientBuildId:event.target.value })}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{memberName(member)}</option>] : [])}</select></label>}
        <label><span>Effect</span><select value={buff.stat} onChange={(event) => void updateBuff(buff.id, { stat:event.target.value as BuffEffect['stat'] })}><option value="amplify">Amplification</option><option value="atkPercent">ATK %</option><option value="hpPercent">HP %</option><option value="defPercent">DEF %</option><option value="critRate">Crit. Rate</option><option value="critDamage">Crit. DMG</option><option value="basicDamage">Basic DMG</option><option value="heavyDamage">Heavy DMG</option><option value="skillDamage">Skill DMG</option><option value="liberationDamage">Liberation DMG</option><option value="healingBonus">Healing Bonus</option></select></label>
        <label><span>Value %</span><input type="number" value={buff.value} onChange={(event) => void updateBuff(buff.id, { value:Number(event.target.value) })}/></label>
        <label><span>Duration</span><input type="number" min="0" step="0.1" value={buff.duration} onChange={(event) => void updateBuff(buff.id, { duration:Math.max(0, Number(event.target.value)) })}/></label>
        <button className="tw-remove" aria-label={`Remove ${buff.name}`} onClick={() => void updateTeam({ buffs:buffs.filter((entry) => entry.id !== buff.id) })}><Icon name="trash"/></button>
      </div>
    })}{!buffs.length && <p className="tw-empty-state">No authored modifiers. Supported weapon, character, sequence, Sonata, Echo, and teammate effects remain controlled above.</p>}</div></div>
  </details>
}

function TeamBuffs({ model, updateTeam }: Props) {
  const providers = model.members.filter((member) => member.build && member.outgoingEffectsV2.length)
  const setAll = (member: TeamMemberModel, enabled: boolean) => {
    if (!member.build) return
    const scenario = model.team.calculationV2 ?? emptyCalculationScenarioV2()
    const current = scenario.partyEffects[member.build.id] ?? {}
    const next = Object.fromEntries(member.outgoingEffectsV2.map((effect) => [effect.id, {
      ...current[effect.id], enabled:effect.alwaysEnabled || enabled,
      ...(effect.hasStacks && enabled ? { stacks:effect.maxStacks } : {}),
      ...(effect.scope === 'next' && !current[effect.id]?.recipientBuildId ? { recipientBuildId:model.members.find((entry) => entry.build && entry.build.id !== member.build!.id)?.build?.id } : {})
    }]))
    void updateTeam({ calculationV2:{ ...scenario, partyEffects:{ ...scenario.partyEffects, [member.build.id]:{ ...current, ...next } } } })
  }
  const effectCount = providers.reduce((total, member) => total + member.outgoingEffectsV2.length, 0)
  return <section className="tw-panel tw-team-buffs">
    <header><div><span className="eyebrow">Team mechanics</span><h2>Team Buffs</h2><p>Configure every supported outgoing character, sequence, weapon, Sonata, and Echo effect once at its source.</p></div><b>{effectCount} effects</b></header>
    <div className="tw-team-buff-providers">{providers.map((member) => <article className="tw-team-buff-provider" style={{ '--tw-member-accent':member.catalog ? ELEMENT_COLORS[member.catalog.element] ?? '#c8d0ce' : '#c8d0ce' } as CSSProperties} key={member.build!.id}>
      <header><span>{member.catalog?.iconSourceUrl && <img src={member.catalog.iconSourceUrl} alt=""/>}<span><strong>{memberName(member)}</strong><small>{member.outgoingEffectsV2.length} outgoing effects</small></span></span><div className="tw-team-buff-provider-tools">{model.sourceStatsV2[member.build!.id] && <dl><div><dt>ER</dt><dd>{model.sourceStatsV2[member.build!.id].energyRegen.toFixed(1)}%</dd></div><div><dt>ATK</dt><dd>{Math.floor(model.sourceStatsV2[member.build!.id].atk).toLocaleString('en-US')}</dd></div><div><dt>HP</dt><dd>{Math.floor(model.sourceStatsV2[member.build!.id].hp).toLocaleString('en-US')}</dd></div></dl>}<span><button type="button" onClick={() => setAll(member, true)}>Enable all</button><button type="button" onClick={() => setAll(member, false)}>Clear</button></span></div></header>
      <div className="tw-team-buff-categories">{CATEGORIES.flatMap((category) => { const effects = member.outgoingEffectsV2.filter((effect) => buffCategory(effect) === category); return effects.length ? [<section className="tw-buff-category" key={category}><header><h3>{category}</h3><b>{effects.length}</b></header><CalculationEffectControls effects={effects} member={member} model={model} updateTeam={updateTeam}/></section>] : [] })}</div>
    </article>)}{!providers.length && <p className="tw-empty-state">Assign supported builds to discover their outgoing team effects.</p>}</div>
  </section>
}

interface Props { model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void> }

export function BuffsWorkspace({ model, updateTeam }: Props) {
  const categoryCounts = model.members.reduce((counts, member) => {
    for (const effect of [...member.calculationEffectsV2, ...member.outgoingEffectsV2]) counts[buffCategory(effect)] = (counts[buffCategory(effect)] ?? 0) + 1
    return counts
  }, {} as Record<string, number>)
  return <div className="tw-buffs-page">
    <section className="tw-settings-intro tw-panel"><div><span className="eyebrow">One source of truth</span><h1>Buffs</h1><p>Configure character modes, weapons, Sonatas, Echoes, sequences, and team outputs here. Every choice feeds Overview, Theorizer, Optimize, and Rotation.</p></div><div>{CATEGORIES.map((category) => <span key={category}><b>{categoryCounts[category] ?? 0}</b><small>{category}</small></span>)}</div></section>
    <section className="tw-panel tw-person-buffs"><header><div><span className="eyebrow">Character inputs</span><h2>Personal buffs and special modes</h2><p>Scopes come from reviewed game data and cannot be changed here. Toggles, stacks, mixed inputs, and mutually exclusive Forte modes are saved per provider.</p></div></header>
      <div className="tw-person-buff-members">{model.members.flatMap((member) => member.build ? [<article className="tw-person-buff-member" key={member.build.id}><header><span>{member.catalog?.iconSourceUrl && <img src={member.catalog.iconSourceUrl} alt=""/>}<span><strong>{memberName(member)}</strong><small>{member.calculationEffectsV2.length} personal effects</small></span></span><CalculationStanceControl member={member} model={model} updateTeam={updateTeam}/></header>{(['character', 'inherent', 'weapon', 'sonata', 'echo', 'sequence'] as const).flatMap((sourceKind) => { const effects = member.calculationEffectsV2.filter((effect) => effect.sourceKind === sourceKind); const label = sourceKind === 'character' || sourceKind === 'inherent' ? 'Forte and character' : sourceKind[0].toUpperCase() + sourceKind.slice(1); return effects.length ? [<section className="tw-buff-category" key={sourceKind}><header><h3>{label}</h3><b>{effects.length}</b></header><CalculationEffectControls effects={effects} member={member} model={model} updateTeam={updateTeam}/></section>] : [] })}</article>] : [])}</div>
    </section>
    <TeamBuffs model={model} updateTeam={updateTeam}/><ManualBuffs model={model} updateTeam={updateTeam}/>
  </div>
}

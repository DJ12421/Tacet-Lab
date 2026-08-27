import {
  emptyCalculationScenarioV2,
  resolveSourceScaledModifierValue,
  type CalculationEffectDefinition,
  type CalculationEffectSelection,
  type CalculationModifier,
  type CalculationSourceStats
} from '../../domain/calculation-v2'
import type { Team } from '../../domain/types'
import type { TeamMemberModel, TeamWorkspaceModel } from '../team-workspace-model'

const EFFECT_MODIFIER_LABELS: Record<string, string> = {
  ATK: 'ATK', HP: 'HP', DEF: 'DEF', ATK_FLAT: 'ATK', ATK_FLAT2: 'ATK',
  Aero: 'Aero DMG', Electro: 'Electro DMG', Fusion: 'Fusion DMG', Glacio: 'Glacio DMG', Havoc: 'Havoc DMG', Spectro: 'Spectro DMG',
  AllElementAttributeBonus: 'All DMG', DMGBonus: 'DMG Bonus', CritRate: 'Crit Rate', CritDMG: 'Crit DMG', EnergyRegen: 'Energy Regen', HealingBonus: 'Healing Bonus',
  BasicAttackDMGBonus: 'Basic Attack DMG', HeavyAttackDMGBonus: 'Heavy Attack DMG', ResonanceSkillDMGBonus: 'Resonance Skill DMG',
  ResonanceLiberationDMGBonus: 'Resonance Liberation DMG', IntroSkillDMGBonus: 'Intro Skill DMG', OutroSkillDMGBonus: 'Outro Skill DMG',
  EchoDMGBonus: 'Echo DMG', CoordinatedDMGBonus: 'Coordinated Attack DMG', CounterAttackDMGBonus: 'Counterattack DMG',
  DEFIgnore: 'DEF Ignore', DefReduction: 'DEF Reduction', tuneBreakBoost: 'Tune Break DMG'
}

const HIDDEN_EFFECT_MODIFIERS = new Set([
  '', '(empty)', 'AppendAnotherTalent', 'EnableAttack', 'MultiplySelfBuff', 'Talent', 'talentModifierMultiply', 'talentModifierMultiplyAdd',
  'talentModifierMultiplySetValue', 'talentModifierSpecialMultiply', 'talentReplace', 'talentTypeOverride'
])

const memberName = (member: TeamMemberModel) => member.catalog?.name ?? member.build?.name ?? `Member ${member.slot + 1}`

function readableEffectText(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\b(Song|Heart|Shadow|Reel|Wishes|Lamp)of\b/g, '$1 of')
    .replace(/\s+/g, ' ')
    .trim()
}

function effectModifierLabel(modifier: string) {
  const key = modifier.replace(/:AdditionalBase$/, '')
  if (HIDDEN_EFFECT_MODIFIERS.has(key)) return ''
  if (EFFECT_MODIFIER_LABELS[key]) return EFFECT_MODIFIER_LABELS[key]
  const [kind, ...scopeParts] = key.split(':')
  const scope = scopeParts.join(' ')
    .replace(/Basic\b/g, 'Basic Attack')
    .replace(/Heavy\b/g, 'Heavy Attack')
    .replace(/Skill\b/g, 'Resonance Skill')
    .replace(/Liberation\b/g, 'Resonance Liberation')
  if (kind === 'DMGDeepen') return scope ? `${scope} DMG Amplification` : 'DMG Amplification'
  if (kind === 'DEFIgnore') return scope ? `${scope} DEF Ignore` : 'DEF Ignore'
  if (kind === 'ResistIgnore') return scope ? `${scope} RES Ignore` : 'RES Ignore'
  if (kind === 'ResistShred') return scope ? `${scope} RES Reduction` : 'RES Reduction'
  if (kind === 'specialMultiplier') return scope ? `${scope} DMG Multiplier` : 'DMG Multiplier'
  if (kind === 'CritRate') return scope ? `${scope} Crit Rate` : 'Crit Rate'
  if (kind === 'CritDMG') return scope ? `${scope} Crit DMG` : 'Crit DMG'
  if (kind === 'CritOverflow') return 'Crit DMG from excess Crit Rate'
  if (kind === 'ForteBased') return `${scope || 'Forte'} DMG`
  return readableEffectText(key.replace(/:/g, ' '))
}

function effectModifierValue(modifier: CalculationModifier, selection: CalculationEffectSelection) {
  if (modifier.modifierByRefinement) return modifier.modifierByRefinement[String(Math.max(1, Math.min(5, selection.refinement ?? 1)))]
  if (typeof modifier.modifierValue === 'number' || typeof modifier.modifierValue === 'string') return Number(modifier.modifierValue)
  if (Array.isArray(modifier.modifierValue)) return Number(modifier.modifierValue[0])
  if (modifier.modifierValue && typeof modifier.modifierValue === 'object') return Number(Object.values(modifier.modifierValue)[0])
  return undefined
}

function conciseEffectRows(effect: CalculationEffectDefinition, selection: CalculationEffectSelection, sourceStats: CalculationSourceStats) {
  const stacks = effect.hasStacks ? Math.max(1, selection.stacks ?? effect.maxStacks) : 1
  const rows = effect.modifiers.flatMap((modifier, index) => {
    const key = modifier.modifier ?? ''
    const label = effectModifierLabel(key)
    const rawValue = effectModifierValue(modifier, selection)
    if (!label) return []
    if (rawValue === undefined || !Number.isFinite(rawValue)) return [{ key: `${key}-${index}`, label, value: '' }]
    const isFlat = effect.valueUnit === 'flat' || /^(?:ATK|HP|DEF)_FLAT/.test(key)
    const resolvedSourceValue = resolveSourceScaledModifierValue(effect, modifier, selection, sourceStats)
    const scaled = resolvedSourceValue !== undefined
      ? resolvedSourceValue
      : modifier.maximumValue !== undefined ? Math.min(rawValue * stacks, modifier.maximumValue) : rawValue * stacks
    const value = isFlat ? scaled : effect.valueUnit === 'decimal' ? scaled * 100 : scaled
    const rounded = Math.round(value * 100) / 100
    return [{
      key: `${key}-${index}`,
      label: `${modifier.modifierBasedOn && resolvedSourceValue === undefined && modifier.maximumValue !== undefined ? 'Up to ' : ''}${label}`,
      value: `${rounded >= 0 ? '+' : ''}${rounded}${isFlat ? '' : '%'}`
    }]
  })
  return effect.duration ? [...rows, { key: 'duration', label: 'Duration', value: `${effect.duration}s` }] : rows
}

function conciseEffectTitle(effect: CalculationEffectDefinition) {
  if (effect.sourceKind === 'sonata') return readableEffectText(effect.sourceId).replace(/\s+\d+\s+Set$/i, '')
  const rawName = effect.name.startsWith(effect.sourceId) ? effect.name.slice(effect.sourceId.length) : effect.name
  return readableEffectText(rawName)
    .replace(/^Stat Bonus:\s*/i, '')
    .replace(/^Sequence Node (\d+):\s*/i, '')
    .replace(/^Inherent Skill:\s*/i, '') || readableEffectText(effect.sourceId)
}

function conciseEffectBadge(effect: CalculationEffectDefinition) {
  if (effect.sourceKind === 'sonata') {
    const pieces = effect.sourceId.match(/(\d+)Set/i)?.[1]
    return pieces ? `${pieces}-Set` : 'Set'
  }
  if (effect.sourceKind === 'sequence' && effect.sequence) return `S${effect.sequence}`
  if (effect.sourceKind === 'party') return 'Team'
  if (effect.sourceKind === 'weapon') return 'Weapon'
  return ''
}

export function CalculationEffectControls({ effects, member, model, updateTeam, disabled = false }: {
  effects: CalculationEffectDefinition[]
  member: TeamMemberModel
  model: TeamWorkspaceModel
  updateTeam: (patch: Partial<Team>) => Promise<void>
  disabled?: boolean
}) {
  const buildId = member.build?.id
  if (!buildId || !effects.length) return null
  const scenario = model.team.calculationV2 ?? emptyCalculationScenarioV2()
  const selectionFor = (effect: CalculationEffectDefinition): CalculationEffectSelection => {
    const isPartyEffect = effect.sourceKind === 'party' || Boolean(effect.sourceBuildId)
    const bucket = isPartyEffect ? scenario.partyEffects : scenario.memberEffects
    const ownerBuildId = isPartyEffect ? effect.sourceBuildId ?? buildId : buildId
    const defaults: CalculationEffectSelection = {
      enabled: effect.alwaysEnabled || /^Stat Bonus:/i.test(effect.name),
      ...(effect.hasStacks ? { stacks: effect.minStacks } : {}),
      ...(effect.scope === 'next' ? { recipientBuildId: model.members.find((entry) => entry.build && entry.build.id !== ownerBuildId)?.build?.id } : {}),
      ...(effect.sourceKind === 'weapon' ? { refinement: member.showcase?.weapon?.owned.rank ?? 1 } : {})
    }
    return {
      ...defaults,
      ...(bucket[ownerBuildId]?.[effect.id]
        ?? (effect.definitionId ? bucket[ownerBuildId]?.[effect.definitionId] : undefined)
        ?? bucket[buildId]?.[effect.id]
        ?? (effect.definitionId ? bucket[buildId]?.[effect.definitionId] : undefined)
        ?? {})
    }
  }
  const setEffect = (effect: CalculationEffectDefinition, patch: Partial<CalculationEffectSelection>) => {
    const isPartyEffect = effect.sourceKind === 'party' || Boolean(effect.sourceBuildId)
    const bucketKey = isPartyEffect ? 'partyEffects' : 'memberEffects'
    const bucket = scenario[bucketKey]
    const ownerBuildId = isPartyEffect ? effect.sourceBuildId ?? buildId : buildId
    void updateTeam({
      calculationV2: {
        ...scenario,
        [bucketKey]: {
          ...bucket,
          [ownerBuildId]: {
            ...bucket[ownerBuildId],
            [effect.id]: { ...selectionFor(effect), ...patch }
          }
        }
      }
    })
  }
  return <div className={`tw-v2-effect-list ${disabled ? 'is-disabled' : ''}`}>
    {effects.map((effect) => {
      const selection = selectionFor(effect)
      const fixed = effect.alwaysEnabled || /^Stat Bonus:/i.test(effect.name)
      const active = fixed || selection.enabled
      const context = effect.sourceKind === 'sonata' ? effect.sourceId.match(/(\d+)Set/i)?.[1] : undefined
      const rows = conciseEffectRows(effect, selection, model.sourceStatsV2)
      const title = conciseEffectTitle(effect)
      const badge = conciseEffectBadge(effect)
      const inlineToggle = !fixed && !effect.trigger
      const toggleEffect = () => setEffect(effect, {
        enabled: !active,
        ...(!active && effect.hasStacks && !(selection.stacks ?? 0) ? { stacks: effect.maxStacks } : {})
      })
      return <article className={fixed ? 'is-fixed' : active ? 'is-active' : 'is-inactive'} key={effect.id} title={effect.description || undefined}>
        <header className="tw-effect-copy"><span>{inlineToggle ? <button type="button" className="tw-effect-title-toggle" disabled={disabled} aria-label={`Toggle ${title}`} aria-pressed={active} onClick={toggleEffect}><i aria-hidden="true"/><strong>{title}</strong></button> : <strong>{title}</strong>}{context && <small>{context}-piece set</small>}</span>{badge && <b>{badge}</b>}</header>
        {((!fixed && Boolean(effect.trigger)) || (effect.hasStacks && active) || (effect.scope === 'next' && active)) && <div className="tw-effect-condition">
          {!fixed && !inlineToggle && <button type="button" className="tw-condition-toggle" disabled={disabled} aria-pressed={active} onClick={toggleEffect}><i aria-hidden="true"/><strong>{effect.trigger ? `After ${readableEffectText(effect.trigger)}` : 'Apply this buff'}</strong></button>}
          {effect.hasStacks && active && <label><span>Stacks</span><select disabled={disabled} value={selection.stacks ?? effect.minStacks} onChange={(event) => setEffect(effect, { enabled: true, stacks: Number(event.target.value) })}>{Array.from({ length: Math.max(1, effect.maxStacks - effect.minStacks + 1) }, (_, index) => effect.minStacks + index).map((stack) => <option value={stack} key={stack}>{stack}</option>)}</select><small>/{effect.maxStacks}</small></label>}
          {effect.scope === 'next' && active && <label><span>Recipient</span><select disabled={disabled} value={selection.recipientBuildId ?? ''} onChange={(event) => setEffect(effect, { enabled: true, recipientBuildId: event.target.value })}>{model.members.flatMap((entry) => entry.build && entry.build.id !== (effect.sourceBuildId ?? buildId) ? [<option value={entry.build.id} key={entry.build.id}>{memberName(entry)}</option>] : [])}</select></label>}
        </div>}
        {active && rows.length > 0 && <dl className="tw-effect-results">{rows.map((row) => <div key={row.key}><dt className={member.catalog?.element && row.label.toLowerCase().includes(member.catalog.element.toLowerCase()) ? 'is-character-element' : ''}>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
      </article>
    })}
  </div>
}

export function CalculationStanceControl({ member, model, updateTeam }: {
  member: TeamMemberModel
  model: TeamWorkspaceModel
  updateTeam: (patch: Partial<Team>) => Promise<void>
}) {
  const buildId = member.build?.id
  const mechanics = member.calculationMechanicsV2
  if (!buildId || !mechanics || mechanics.stances.length < 2) return null
  const scenario = model.team.calculationV2 ?? emptyCalculationScenarioV2()
  const effectId = `character:${mechanics.key}:stance`
  const current = String(scenario.memberEffects[buildId]?.[effectId]?.value ?? mechanics.stances[0])
  const choose = (value: string) => void updateTeam({
    calculationV2: {
      ...scenario,
      memberEffects: {
        ...scenario.memberEffects,
        [buildId]: {
          ...scenario.memberEffects[buildId],
          [effectId]: { enabled: true, value }
        }
      }
    }
  })
  const segmented = mechanics.stances.length <= 4
  return <div className="tw-v2-stance"><span>Forte mode</span>{segmented && <div className="tw-stance-segments" role="radiogroup" aria-label={`${memberName(member)} Forte mode`}>{mechanics.stances.map((stance) => <button type="button" role="radio" aria-checked={current === stance} onClick={() => choose(stance)} key={stance}>{stance}</button>)}</div>}<select className={segmented ? 'tw-stance-fallback' : 'tw-stance-only'} aria-label={`${memberName(member)} Forte mode`} value={current} onChange={(event) => choose(event.target.value)}>{mechanics.stances.map((stance) => <option value={stance} key={stance}>{stance}</option>)}</select></div>
}

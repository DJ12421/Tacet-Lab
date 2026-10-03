import type {
  ActionMechanics,
  ActionRequest,
  CalculationDiagnostic,
  CombatMember,
  EffectMechanics,
  EffectOperation,
  MechanicsRegistry,
  StatValue,
  TriggeredActionMechanics,
  ActionUseAdjustment
} from './contract'

export class EffectResolutionFailure extends Error {
  constructor(readonly diagnostic: CalculationDiagnostic) {
    super(diagnostic.message)
  }
}

export interface ResolvedEffects {
  statLines: readonly StatValue[]
  damageBonuses: readonly number[]
  motionValueBonuses: readonly number[]
  amplifications: readonly number[]
  vulnerabilities: readonly number[]
  finalDamageBonuses: readonly number[]
  specialMultipliers: readonly number[]
  damageTakenReduction: number
  defenseReduction: number
  defenseIgnore: number
  resistanceReduction: number
  resistanceIgnore: number
  critOverride?: 'never' | 'always'
  appliedEffects: readonly string[]
  triggeredActions: readonly TriggeredActionMechanics[]
  actionUseAdjustments: readonly ActionUseAdjustment[]
  contributions: {
    statLines: readonly { label: string; value: StatValue }[]
    damageBonuses: readonly { label: string; value: number }[]
    motionValueBonuses: readonly { label: string; value: number }[]
    amplifications: readonly { label: string; value: number }[]
    vulnerabilities: readonly { label: string; value: number }[]
    finalDamageBonuses: readonly { label: string; value: number }[]
    specialMultipliers: readonly { label: string; value: number }[]
    defenseReduction: readonly { label: string; value: number }[]
    defenseIgnore: readonly { label: string; value: number }[]
    resistanceReduction: readonly { label: string; value: number }[]
    resistanceIgnore: readonly { label: string; value: number }[]
  }
}

interface EffectCandidate {
  effect: EffectMechanics
  provider: CombatMember
  eligible: boolean
}

const AERO_ROVER_IDS = new Set(['1406','1408'])
const AERO_ROVER_BLOODPACT_PLEDGE_EFFECT = 'weapon:21020046:weapon:21020046:effect:1'

function fail(diagnostic: CalculationDiagnostic): never {
  throw new EffectResolutionFailure(diagnostic)
}

function reviewed(sourceId: string, reviewFingerprint: string, actorId: string, actionId: string) {
  if (typeof sourceId !== 'string' || !sourceId.trim() || typeof reviewFingerprint !== 'string' || !reviewFingerprint.trim()) fail({
    code: 'stale-data',
    message: 'Effect mechanics require a source ID and review fingerprint.',
    sourceId: typeof sourceId === 'string' && sourceId ? sourceId : undefined,
    actorId,
    actionId
  })
}

function finite(value: number, label: string, effect: EffectMechanics, request: ActionRequest) {
  if (!Number.isFinite(value)) fail({ code: 'invalid-input', message: `${label} must be finite.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
  return value
}

function candidateEffects(registry: MechanicsRegistry, request: ActionRequest): EffectCandidate[] {
  const candidates: EffectCandidate[] = []
  for (const provider of request.setup.members) {
    const character = registry.characters[provider.character.id]
    const weapon = registry.weapons[provider.weapon.id]
    if (!character) fail({ code: 'missing-mechanic', message: `Character ${provider.character.id} is not in the registry.`, actorId: provider.memberId, actionId: request.actionId })
    if (!weapon) fail({ code: 'missing-mechanic', message: `Weapon ${provider.weapon.id} is not in the registry.`, actorId: provider.memberId, actionId: request.actionId })

    for (const effect of character.effects ?? []) candidates.push({
      effect,
      provider,
      eligible: provider.character.sequence >= (effect.minimumSequence ?? 0)
    })
    for (const effect of weapon.effects ?? []) candidates.push({
      effect,
      provider,
      eligible: provider.weapon.rank >= (effect.minimumRank ?? 1)
        && provider.weapon.rank <= (effect.maximumRank ?? Number.POSITIVE_INFINITY)
        && (effect.sourceId !== AERO_ROVER_BLOODPACT_PLEDGE_EFFECT || AERO_ROVER_IDS.has(provider.character.id))
    })

    if (provider.mainEchoId) {
      const equipped = provider.echoes.find((echo) => echo.instanceId === provider.mainEchoId)
      if (!equipped) fail({ code: 'invalid-input', message: `Main Echo ${provider.mainEchoId} is not equipped.`, sourceId: provider.mainEchoId, actorId: provider.memberId, actionId: request.actionId })
      const echo = registry.echoes?.[equipped.catalogId]
      if (!echo) fail({ code: 'missing-mechanic', message: `Main Echo ${equipped.catalogId} has no reviewed mechanics.`, sourceId: equipped.catalogId, actorId: provider.memberId, actionId: request.actionId })
      if (echo.id !== equipped.catalogId) fail({ code: 'invalid-input', message: `Echo registry key ${equipped.catalogId} does not match ${echo.id}.`, sourceId: echo.sourceId, actorId: provider.memberId, actionId: request.actionId })
      reviewed(echo.sourceId, echo.reviewFingerprint, provider.memberId, request.actionId)
      for (const effect of echo.effects) candidates.push({ effect, provider, eligible: true })
    }

    const sonataCounts = provider.echoes.reduce<Record<string, number>>((counts, echo) => {
      counts[echo.sonataId] = (counts[echo.sonataId] ?? 0) + 1
      return counts
    }, {})
    for (const [sonataId, pieces] of Object.entries(sonataCounts)) {
      const sonata = registry.sonatas?.[sonataId]
      if (!sonata) {
        if (pieces >= 2) fail({ code: 'missing-mechanic', message: `Sonata ${sonataId} has no reviewed mechanics.`, sourceId: sonataId, actorId: provider.memberId, actionId: request.actionId })
        continue
      }
      if (sonata.id !== sonataId) fail({ code: 'invalid-input', message: `Sonata registry key ${sonataId} does not match ${sonata.id}.`, sourceId: sonata.sourceId, actorId: provider.memberId, actionId: request.actionId })
      reviewed(sonata.sourceId, sonata.reviewFingerprint, provider.memberId, request.actionId)
      for (const effect of sonata.effects) candidates.push({
        effect,
        provider,
        eligible: pieces >= (effect.minimumPieces ?? 2)
      })
    }
  }
  return candidates.filter(({ effect, provider }) => !request.setup.disabledEffectIdsByMember?.[provider.memberId]?.includes(effect.id))
}

function inputValues(request: ActionRequest) {
  const values: Record<string, boolean | number | string> = { ...request.setup.selections }
  for (const [key, value] of Object.entries(request.inputs ?? {})) {
    if (key in values && values[key] !== value) fail({ code: 'invalid-input', message: `Input ${key} has contradictory setup and action values.`, actorId: request.actorId, actionId: request.actionId })
    values[key] = value
  }
  return values
}

function activationFactor(effect: EffectMechanics, values: Readonly<Record<string, boolean | number | string>>, request: ActionRequest, provider: CombatMember) {
  const selected = (input: string) => values[`${provider.memberId}:${input}`] ?? values[input]
  const inputValue = (input: string) => selected(input) === true ? 1 : typeof selected(input) === 'number' ? selected(input) as number : 0
  const unmetRequirement = effect.activation.requires?.find((requirement) => inputValue(requirement.input) < (requirement.minimum ?? 1))
  if (unmetRequirement) {
    const ownInput = effect.activation.kind === 'conditional-value' ? effect.activation.toggleInput
      : effect.activation.kind === 'toggle' || effect.activation.kind === 'stacks' || effect.activation.kind === 'value' ? effect.activation.input : undefined
    if (ownInput && inputValue(ownInput) > 0) fail({ code:'invalid-input', message:`Effect input ${ownInput} requires ${unmetRequirement.input} to be at least ${unmetRequirement.minimum ?? 1}.`, sourceId:effect.sourceId, actorId:request.actorId, actionId:request.actionId })
    return 0
  }
  if (effect.activation.suppressedBy?.some((input) => inputValue(input) > 0)) return 0
  if (effect.activation.kind === 'always') return 1
  if (effect.activation.kind === 'all') return effect.activation.inputs.every((input) => selected(input) === true || (typeof selected(input) === 'number' && (selected(input) as number) > 0)) ? 1 : 0
  if (effect.activation.kind === 'conditional-value') {
    const enabled = selected(effect.activation.toggleInput)
    if (enabled === undefined || enabled === false) return 0
    if (enabled !== true) fail({ code: 'invalid-input', message: `Effect input ${effect.activation.toggleInput} must be boolean.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
    const recipient = request.setup.members.find((member) => member.memberId === request.actorId)
    const source = effect.activation.source === 'provider' ? provider : recipient
    const value = source?.conditionStats?.[effect.activation.stat]
    if (typeof value !== 'number' || !Number.isFinite(value)) fail({ code: 'invalid-input', message: `${effect.activation.stat} must be provided for ${effect.activation.source === 'provider' ? provider.memberId : request.actorId}.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
    if (!Number.isFinite(effect.activation.minimum) || !Number.isFinite(effect.activation.maximum) || effect.activation.minimum < 0 || effect.activation.maximum < effect.activation.minimum) fail({ code: 'invalid-input', message: `Effect ${effect.id} has invalid activation limits.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
    if (value < effect.activation.minimum || value > effect.activation.maximum) fail({ code: 'invalid-input', message: `${effect.activation.stat} must be between ${effect.activation.minimum} and ${effect.activation.maximum}.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
    return value
  }
  const value = selected(effect.activation.input)
  if (effect.activation.kind === 'toggle') {
    if (value === undefined || value === false) return 0
    if (value !== true) fail({ code: 'invalid-input', message: `Effect input ${effect.activation.input} must be boolean.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
    return 1
  }
  if (value === undefined || value === 0) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || (effect.activation.kind === 'stacks' && !Number.isInteger(value))) fail({ code: 'invalid-input', message: `${effect.activation.kind === 'stacks' ? 'Stack' : 'Value'} input ${effect.activation.input} must be a valid ${effect.activation.kind === 'stacks' ? 'integer' : 'number'}.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
  if (!Number.isFinite(effect.activation.minimum) || !Number.isFinite(effect.activation.maximum) || effect.activation.minimum < 0 || effect.activation.maximum < effect.activation.minimum) fail({ code: 'invalid-input', message: `Effect ${effect.id} has invalid activation limits.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
  if (value < effect.activation.minimum || value > effect.activation.maximum) fail({ code: 'invalid-input', message: `Input ${effect.activation.input} must be between ${effect.activation.minimum} and ${effect.activation.maximum}.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
  return value
}

function matchesFilter(filter: EffectMechanics['filter'], action: ActionMechanics) {
  if (!filter) return true
  if (filter.actionIds && !filter.actionIds.includes(action.id)) return false
  if (filter.damageTypes && (!action.damageType || !filter.damageTypes.includes(action.damageType))) return false
  if (filter.elements && (!action.element || !filter.elements.includes(action.element))) return false
  if (filter.tags && !filter.tags.some((tag) => action.tags?.includes(tag))) return false
  return true
}

function matchesOperation(effect: EffectMechanics, operation: EffectOperation, action: ActionMechanics) {
  if (!matchesFilter(operation.filter, action)) return false
  if (operation.kind !== 'ignore-defense') return true
  if (action.damageType === 'status') return false
  const elementSpecific = Boolean(effect.filter?.elements?.length || operation.filter?.elements?.length)
  return action.damageType !== 'tune-break' || !elementSpecific
}

function activationInputs(effect: EffectMechanics) {
  return [
    ...(effect.activation.kind === 'always' ? [] : effect.activation.kind === 'all' ? effect.activation.inputs : effect.activation.kind === 'conditional-value' ? [effect.activation.toggleInput] : [effect.activation.input]),
    ...(effect.activation.requires?.map((requirement) => requirement.input) ?? []),
    ...(effect.activation.suppressedBy ?? [])
  ]
}

export function resolveEffects(registry: MechanicsRegistry, request: ActionRequest, action: ActionMechanics): ResolvedEffects {
  const candidates = candidateEffects(registry, request)
  const values = inputValues(request)
  const knownInputs = new Set(candidates.flatMap(({ effect }) => activationInputs(effect)))
  const knownScopedInputs = new Set(candidates.flatMap(({ effect, provider }) => activationInputs(effect).map((input) => `${provider.memberId}:${input}`)))
  for (const key of Object.keys(values)) if (!knownInputs.has(key) && !knownScopedInputs.has(key)) fail({ code: 'missing-mechanic', message: `Input ${key} does not match a reviewed effect.`, sourceId: key, actorId: request.actorId, actionId: request.actionId })

  const statLines: StatValue[] = []
  const damageBonuses: number[] = []
  const motionValueBonuses: number[] = []
  const amplifications: number[] = []
  const vulnerabilities: number[] = []
  const finalDamageBonuses: number[] = []
  const appliedEffects: string[] = []
  const triggeredActions: TriggeredActionMechanics[] = []
  const actionUseAdjustments: ActionUseAdjustment[] = []
  const contributions = {
    statLines: [] as { label: string; value: StatValue }[],
    damageBonuses: [] as { label: string; value: number }[],
    motionValueBonuses: [] as { label: string; value: number }[],
    amplifications: [] as { label: string; value: number }[],
    vulnerabilities: [] as { label: string; value: number }[],
    finalDamageBonuses: [] as { label: string; value: number }[],
    specialMultipliers: [] as { label: string; value: number }[],
    defenseReduction: [] as { label: string; value: number }[],
    defenseIgnore: [] as { label: string; value: number }[],
    resistanceReduction: [] as { label: string; value: number }[],
    resistanceIgnore: [] as { label: string; value: number }[]
  }
  const appliedIds = new Set<string>()
  const exclusiveGroups = new Map<string, string>()
  let defenseReduction = 0
  let damageTakenReduction = 0
  let defenseIgnore = 0
  let resistanceReduction = 0
  let resistanceIgnore = 0
  let critOverride: 'never' | 'always' | undefined

  for (const { effect, provider, eligible } of candidates) {
    reviewed(effect.sourceId, effect.reviewFingerprint, request.actorId, request.actionId)
    if (!eligible || !matchesFilter(effect.filter, action)) continue
    const matchingOperations = effect.operations.filter((operation) => {
      const recipient = operation.recipient ?? effect.recipient ?? 'self'
      return (recipient === 'team' || recipient === 'next' || provider.memberId === request.actorId) && matchesOperation(effect, operation, action)
    })
    const payloadEligible = provider.memberId === request.actorId && Boolean(effect.triggeredActions?.length || effect.actionUseAdjustments?.length)
    if (matchingOperations.length === 0 && !payloadEligible) continue
    const factor = activationFactor(effect, values, request, provider)
    if (factor === 0) continue
    const operations = matchingOperations.filter((operation) => operation.minimumActivation === undefined || factor >= operation.minimumActivation)
    if (operations.length === 0 && !payloadEligible) continue
    if (appliedIds.has(effect.id)) continue
    appliedIds.add(effect.id)
    if (effect.exclusiveGroup) {
      const active = exclusiveGroups.get(effect.exclusiveGroup)
      if (active) fail({ code: 'invalid-input', message: `Effects ${active} and ${effect.id} are mutually exclusive.`, sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
      exclusiveGroups.set(effect.exclusiveGroup, effect.id)
    }
    appliedEffects.push(effect.id)
    if (payloadEligible) {
      triggeredActions.push(...(effect.triggeredActions ?? []))
      actionUseAdjustments.push(...(effect.actionUseAdjustments ?? []))
    }

    for (const operation of operations) {
      const label = effect.name ?? 'Reviewed effect'
      if (operation.kind === 'override-crit') {
        if (factor !== 1) fail({ code: 'unsupported-mechanic', message: 'Stacked critical overrides are not supported.', sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
        if (critOverride && critOverride !== operation.mode) fail({ code: 'invalid-input', message: 'Active critical overrides contradict each other.', sourceId: effect.sourceId, actorId: request.actorId, actionId: request.actionId })
        critOverride = operation.mode
        continue
      }
      const operationFactor = (effect.activation.kind === 'stacks' || effect.activation.kind === 'value' || effect.activation.kind === 'conditional-value') && operation.stacking !== 'once' ? factor : 1
      const value = Math.min(finite(operation.value, `${operation.kind} value`, effect, request) * operationFactor, operation.maximumValue ?? Number.POSITIVE_INFINITY)
      if (operation.kind === 'add-flat-stat') { const line = { stat: operation.stat, mode: 'flat' as const, value }; statLines.push(line); contributions.statLines.push({ label, value:line }) }
      else if (operation.kind === 'add-percent-stat') { const line = { stat: operation.stat, mode: 'percent' as const, value }; statLines.push(line); contributions.statLines.push({ label, value:line }) }
      else if (operation.kind === 'add-damage-bonus') { damageBonuses.push(value); contributions.damageBonuses.push({ label, value }) }
      else if (operation.kind === 'increase-motion-value') { motionValueBonuses.push(value); contributions.motionValueBonuses.push({ label, value }) }
      else if (operation.kind === 'amplify-damage') { amplifications.push(value); contributions.amplifications.push({ label, value }) }
      else if (operation.kind === 'add-vulnerability') { vulnerabilities.push(value); contributions.vulnerabilities.push({ label, value }) }
      else if (operation.kind === 'add-final-damage') { finalDamageBonuses.push(value); contributions.finalDamageBonuses.push({ label, value }) }
      else if (operation.kind === 'reduce-damage-taken') damageTakenReduction += value
      else if (operation.kind === 'reduce-defense') { defenseReduction += value; contributions.defenseReduction.push({ label, value }) }
      else if (operation.kind === 'ignore-defense') { defenseIgnore += value; contributions.defenseIgnore.push({ label, value }) }
      else if (operation.kind === 'reduce-resistance') { resistanceReduction += value; contributions.resistanceReduction.push({ label, value }) }
      else if (operation.kind === 'ignore-resistance') { resistanceIgnore += value; contributions.resistanceIgnore.push({ label, value }) }
    }
  }

  return {
    statLines,
    damageBonuses,
    motionValueBonuses,
    amplifications,
    vulnerabilities,
    finalDamageBonuses,
    specialMultipliers:[],
    damageTakenReduction,
    defenseReduction,
    defenseIgnore,
    resistanceReduction,
    resistanceIgnore,
    critOverride,
    appliedEffects,
    triggeredActions,
    actionUseAdjustments,
    contributions
  }
}

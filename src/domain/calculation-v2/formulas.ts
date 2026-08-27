export interface FormulaInstance {
  percentage: string
  damage: number
  count: number
}

export interface FormulaResult {
  totalDamage?: number
  critDamage?: number
  avgDamage?: number
  healAmount?: number
  shieldAmount?: number
  instanceDamageEntries?: FormulaInstance[]
  totalDamageContext?: Record<string, unknown>
}

function parseLevel(value: string) {
  const level = Number.parseInt(value.replace('+', ''), 10)
  return Number.isFinite(level) ? level : 90
}

function parseMotionValues(value: string) {
  return value.split('+').flatMap((part) => {
    const [rawPercentage, rawCount] = part.trim().split('*').map((entry) => entry.trim())
    const percentage = Number.parseFloat(rawPercentage.replace('%', '')) / 100
    const count = rawCount ? Number.parseInt(rawCount, 10) : 1
    if (!Number.isFinite(percentage) || !Number.isFinite(count) || count < 1) return []
    return Array.from({ length: count }, () => percentage)
  })
}

function parseScalingFormula(value: string) {
  let ratio = 0
  let flat = 0
  value.split('+').forEach((part) => {
    const trimmed = part.trim()
    const parsed = Number.parseFloat(trimmed.replace('%', ''))
    if (!Number.isFinite(parsed)) return
    if (trimmed.includes('%')) ratio += parsed / 100
    else flat += parsed
  })
  return { ratio, flat }
}

function defenseMultiplier(characterLevel: number, enemyLevel: number, ignore: number, reduction: number) {
  const attackerDefense = 800 + 8 * characterLevel
  const enemyDefense = 792 + 8 * enemyLevel
  return attackerDefense / (attackerDefense + enemyDefense * Math.max(0, 1 - ignore) * Math.max(0, 1 - reduction))
}

function resistanceMultiplier(base: number, reduction: number, ignore: number) {
  const resistance = base - reduction - ignore
  if (resistance < 0) return 1 - resistance / 2
  if (resistance < 0.8) return 1 - resistance
  return 1 / (1 + 5 * resistance)
}

function criticalValues(normal: number, critRate: number, critDamage: number) {
  const rate = Math.max(0, Math.min(1, critRate))
  const multiplier = Math.max(1, critDamage)
  return {
    critDamage: normal * multiplier,
    avgDamage: normal * (1 + rate * (multiplier - 1))
  }
}

export function calcDamage(
  characterLevelSpec: string,
  enemyLevel: number,
  enemyResistance: number,
  talent: string,
  scalingStat: number,
  defenseIgnore = 0,
  totalDamageBonus = 0,
  specificDamageBonus = 0,
  elementalDamageBonus = 0,
  deepen = 0,
  resistanceReduction = 0,
  critRate = 0,
  critDamage = 1,
  additionalMotionValue = 0,
  motionValueMultiplier = 0,
  specialMotionValueMultiplier = 0,
  count = 1,
  _skillKey = '',
  _additiveMultiplierStacks = 0,
  _additiveMultiplierPercent = 0,
  specialMultiplier = 0,
  defenseReduction = 0,
  resistanceIgnore = 0
): FormulaResult {
  const motionValues = parseMotionValues(talent)
  if (motionValues.length) motionValues[motionValues.length - 1] += additionalMotionValue
  const adjustedMotionValues = motionValues.map((value) => value * (1 + motionValueMultiplier) * (1 + specialMotionValueMultiplier))
  const characterLevel = parseLevel(characterLevelSpec)
  const defense = defenseMultiplier(characterLevel, enemyLevel, defenseIgnore, defenseReduction)
  const resistance = resistanceMultiplier(enemyResistance, resistanceReduction, resistanceIgnore)
  const bonus = 1 + totalDamageBonus + specificDamageBonus + elementalDamageBonus
  const amplifier = (1 + deepen) * (1 + specialMultiplier)
  const instanceDamageEntries = adjustedMotionValues.map((motionValue, index) => ({
    percentage: `${(motionValues[index] * 100).toFixed(2)}%`,
    damage: scalingStat * motionValue * bonus * amplifier * defense * resistance,
    count: 1
  }))
  const singleUseDamage = instanceDamageEntries.reduce((total, entry) => total + entry.damage, 0)
  const totalDamage = singleUseDamage * count
  return {
    totalDamage,
    ...criticalValues(totalDamage, critRate, critDamage),
    instanceDamageEntries,
    totalDamageContext: {
      type: 'attack',
      characterLevel,
      enemyLevel,
      totalMotionValue: adjustedMotionValues.reduce((total, value) => total + value, 0),
      scalingStat,
      bonus,
      deepen,
      defenseMultiplier: defense,
      resistanceMultiplier: resistance,
      specialMultiplier,
      count
    }
  }
}

export function calcFixedDamage(talent: string, count = 1): FormulaResult {
  const totalDamage = (Number.parseFloat(talent) || 0) * count
  return { totalDamage, critDamage: totalDamage, avgDamage: totalDamage, totalDamageContext: { type: 'fixed', count } }
}

export function calcHeal(
  talent: string,
  scalingStat = 0,
  healingBonus = 0,
  specificBonus = 0,
  additionalMotionValue = 0,
  motionValueMultiplier = 0,
  specialMotionValueMultiplier = 0,
  count = 1
): FormulaResult {
  const parsed = parseScalingFormula(talent)
  const motionMultiplier = (1 + motionValueMultiplier) * (1 + specialMotionValueMultiplier)
  const ratio = (parsed.ratio + additionalMotionValue) * motionMultiplier
  const flat = parsed.flat * motionMultiplier
  const healAmount = (scalingStat * ratio + flat) * (1 + healingBonus + specificBonus) * count
  return { healAmount, totalDamageContext: { type: 'healing', ratio, flat, scalingStat, healingBonus, specificBonus, count } }
}

export function calcShield(
  talent: string,
  scalingStat = 0,
  shieldBonus = 0,
  specificBonus = 0,
  additionalMotionValue = 0,
  motionValueMultiplier = 0,
  count = 1
): FormulaResult {
  const parsed = parseScalingFormula(talent)
  const ratio = (parsed.ratio + additionalMotionValue) * (1 + motionValueMultiplier)
  const flat = parsed.flat * (1 + motionValueMultiplier)
  const shieldAmount = (scalingStat * ratio + flat) * (1 + shieldBonus + specificBonus) * count
  return { shieldAmount, totalDamageContext: { type: 'shield', ratio, flat, scalingStat, shieldBonus, specificBonus, count } }
}

const TUNE_BREAK_LEVEL_MULTIPLIERS: Record<number, number> = {
  1: 2.215,
  20: 5.932,
  40: 29.357,
  50: 60.934,
  60: 130.868,
  70: 249.715,
  80: 437.085,
  90: 716.22
}

const TUNE_BREAK_ENEMY_MULTIPLIERS: Record<string, number> = {
  Common: 1,
  Elite: 3,
  Overlord: 14,
  Calamity: 14
}

export function calcTuneBreak(
  talent: string,
  characterLevelSpec: string,
  enemyLevel: number,
  enemyResistance: number,
  enemyClass: string,
  resistanceReduction: number,
  defenseIgnore = 0,
  defenseReduction = 0,
  tuneBreakBonus = 0,
  motionValueMultiplier = 0,
  specialMultiplier = 0,
  damageBonus = 0,
  critRate = 0,
  critDamage = 1,
  count = 1,
  resistanceIgnore = 0
): FormulaResult {
  const characterLevel = parseLevel(characterLevelSpec)
  const levelMultiplier = TUNE_BREAK_LEVEL_MULTIPLIERS[characterLevel] ?? TUNE_BREAK_LEVEL_MULTIPLIERS[90]
  const classMultiplier = TUNE_BREAK_ENEMY_MULTIPLIERS[enemyClass] ?? TUNE_BREAK_ENEMY_MULTIPLIERS.Overlord
  const defense = defenseMultiplier(characterLevel, enemyLevel, defenseIgnore, defenseReduction)
  const resistance = resistanceMultiplier(enemyResistance, resistanceReduction, resistanceIgnore)
  const motionValues = parseMotionValues(talent)
  const instanceDamageEntries = motionValues.map((motionValue) => ({
    percentage: `${(motionValue * 100).toFixed(2)}%`,
    damage: levelMultiplier * motionValue * (1 + motionValueMultiplier) * (1 + specialMultiplier)
      * defense * resistance * (1 + damageBonus) * classMultiplier * (1 + tuneBreakBonus),
    count: 1
  }))
  const totalDamage = instanceDamageEntries.reduce((total, entry) => total + entry.damage, 0) * count
  return {
    totalDamage,
    ...criticalValues(totalDamage, critRate, critDamage),
    instanceDamageEntries,
    totalDamageContext: {
      type: 'tuneBreak', characterLevel, enemyLevel, levelMultiplier, classMultiplier,
      defenseMultiplier: defense, resistanceMultiplier: resistance, tuneBreakBonus, damageBonus, count
    }
  }
}

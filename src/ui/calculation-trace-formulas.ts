import type { CalculationTrace } from '../domain/combat'

export interface TraceFormulaLine { label: string; result: string; expression: string }

const find = (trace: CalculationTrace, stage: string) => trace.children.find((entry) => entry.stage === stage)
const hasValues = (trace: CalculationTrace, stages: string[]) => stages.every((stage) => typeof find(trace, stage)?.value === 'number')
const number = (trace?: CalculationTrace) => typeof trace?.value === 'number' ? trace.value : 0
const format = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 6 })
const percent = (value: number) => `${format(value * 100)}%`
const value = (trace?: CalculationTrace) => format(number(trace))
const factor = (trace?: CalculationTrace) => percent(number(trace))
const line = (label: string, result: string, expression: string): TraceFormulaLine => ({ label, result, expression })

export function traceFormulaLines(trace: CalculationTrace): TraceFormulaLine[] | null {
  const mode = find(trace, 'result-mode')?.value
  if (trace.stage !== 'rotation' && mode !== 'normal' && mode !== 'critical' && mode !== 'expected') return null
  const selected = mode === 'critical' ? 'Critical' : mode === 'expected' ? 'Average' : 'Normal'
  const triggered = find(trace, 'triggered-actions')

  if (trace.stage === 'damage') {
    const power = find(trace, 'scaling-power')
    const bonus = find(trace, 'bonus-factor')
    const amplify = find(trace, 'amplification-factor')
    const vulnerability = find(trace, 'vulnerability-factor')
    const final = find(trace, 'final-damage-factor')
    const special = find(trace, 'special-multiplier')
    const reduction = find(trace, 'damage-reduction-factor')
    const defense = find(trace, 'defence-multiplier')
    const resistance = find(trace, 'resistance-multiplier')
    const hits = trace.children.filter((entry) => /^hit-\d+$/.test(entry.stage))
    if (!power || !bonus || !amplify || !vulnerability || !final || !special || !reduction || !defense || !resistance || !hits.length || !find(trace, 'crit-enabled') || !hasValues(trace, ['scaling-power', 'bonus-factor', 'amplification-factor', 'vulnerability-factor', 'final-damage-factor', 'special-multiplier', 'damage-reduction-factor', 'defence-multiplier', 'resistance-multiplier']) || !hits.every((hit) => hasValues(hit, ['motion-value', 'motion-value-factor', 'pre-crit', 'result-normal', 'result-critical', 'result-expected'])) || triggered && !hasValues(triggered, ['result-normal', 'result-critical', 'result-expected'])) return null

    const critRate = find(trace, 'crit-rate')
    const critDamage = find(trace, 'crit-damage')
    const critEnabled = find(trace, 'crit-enabled')?.value === 'yes'
    if (critEnabled && !hasValues(trace, ['crit-rate', 'crit-damage'])) return null
    const triggeredTotal = (resultMode: 'normal' | 'critical' | 'expected') => triggered ? number(find(triggered, `result-${resultMode}`)) : 0
    const total = (resultMode: 'normal' | 'critical' | 'expected') => hits.reduce((sum, hit) => sum + number(find(hit, `result-${resultMode}`)), triggeredTotal(resultMode))
    const triggeredTerm = (resultMode: 'normal' | 'critical' | 'expected') => triggeredTotal(resultMode) ? ` + ${format(triggeredTotal(resultMode))} triggered damage` : ''
    if (typeof trace.value !== 'number' || Math.abs(trace.value - total(mode === 'critical' || mode === 'expected' ? mode : 'normal')) > 1e-6) return null
    const lines = [line('Normal attack damage', format(total('normal')), `${hits.map((hit) => value(find(hit, 'result-normal'))).join(' + ')}${triggeredTerm('normal')}`)]

    for (const [index, hit] of hits.entries()) {
      const motion = find(hit, 'motion-value')
      const motionFactor = find(hit, 'motion-value-factor')
      const flat = find(hit, 'flat-damage')
      const preCrit = find(hit, 'pre-crit')
      if (!motion || !motionFactor || !preCrit) continue
      lines.push(line(`Hit ${index + 1} motion value`, percent(number(motion) * number(motionFactor)), `${factor(motion)} × ${factor(motionFactor)}`))
      lines.push(line(`Hit ${index + 1} before crit`, value(preCrit), `max(0, (${value(power)} × ${factor(motion)} × ${factor(motionFactor)}${flat ? ` + ${value(flat)}` : ''}) × ${[bonus, amplify, vulnerability, final, special, reduction, defense, resistance].map(factor).join(' × ')})`))
    }

    if (power.children.length) lines.push(line('Scaling power', value(power), power.children.map((source) => {
      const stat = source.children[0]
      const ratio = source.children.find((entry) => entry.stage === 'percent:Scaling ratio')
      return `${source.stage === 'scaling:Energy Regen' ? format(number(stat) * 100) : `floor(${value(stat)})`} × ${factor(ratio)}`
    }).join(' + ')))

    for (const [node, label] of [[bonus, 'DMG bonus'], [amplify, 'Amplification'], [vulnerability, 'Vulnerability'], [final, 'Final DMG']] as const) {
      lines.push(line(label, factor(node), `max(0, 100%${node.children.map((source) => ` + ${factor(source)}`).join('')})`))
    }
    lines.push(line('Special multiplier', factor(special), special.children.length ? `100% × ${special.children.map((source) => `max(0, 100% + ${factor(source)})`).join(' × ')}` : '100%'))
    lines.push(line('Enemy DMG reduction', factor(reduction), `max(0, 100% − ${factor(reduction.children[0])})`))

    const characterLevel = find(defense, 'number:Character level')
    const enemyLevel = find(defense, 'number:Enemy level')
    const defReduction = find(defense, 'percent:DEF reduction')
    const defIgnore = find(defense, 'percent:DEF ignore')
    if (characterLevel && enemyLevel) lines.push(line('Defense multiplier', factor(defense), `(800 + 8 × ${value(characterLevel)}) ÷ ((800 + 8 × ${value(characterLevel)}) + floor((792 + 8 × ${value(enemyLevel)}) × (100% − ${factor(defReduction)})) × (100% − ${factor(defIgnore)}))`))

    const baseRes = resistance.children[0]
    const resReduction = find(resistance, 'percent:RES reduction')
    const resIgnore = find(resistance, 'percent:RES ignore')
    if (baseRes) {
      const effective = number(baseRes) - number(resReduction) - number(resIgnore)
      const resExpression = `${factor(baseRes)} − ${factor(resReduction)} − ${factor(resIgnore)}`
      lines.push(line('Effective resistance', percent(effective), resExpression))
      lines.push(line('Resistance multiplier', factor(resistance), effective < 0 ? `100% − (${percent(effective)}) ÷ 2` : effective < .8 ? `100% − ${percent(effective)}` : `100% ÷ (1 + 5 × ${percent(effective)})`))
    }
    const hitFormula = (critFactor: string) => hits.map((hit) => `floor(${value(find(hit, 'pre-crit'))} × ${critFactor})`).join(' + ')
    const normalHits = hits.map((hit) => value(find(hit, 'result-normal'))).join(' + ')
    lines.push(line('Crit damage', format(total('critical')), `${critEnabled ? hitFormula(factor(critDamage)) : normalHits}${triggeredTerm('critical')}`))
    lines.push(line('Average damage', format(total('expected')), `${critEnabled ? hitFormula(`(100% + ${factor(critRate)} × (${factor(critDamage)} − 100%))`) : normalHits}${triggeredTerm('expected')}`))
    return lines
  }

  if (trace.stage === 'fixed-damage') {
    const hits = trace.children.filter((entry) => /^hit-\d+$/.test(entry.stage))
    return hits.length && hits.every((hit) => hasValues(hit, ['result'])) && typeof trace.value === 'number' && Math.abs(trace.value - hits.reduce((total, hit) => total + number(find(hit, 'result')), number(triggered))) < 1e-6 ? [line('Fixed damage total', value(trace), `${hits.map((hit) => value(find(hit, 'result'))).join(' + ')}${number(triggered) ? ` + ${value(triggered)} triggered damage` : ''}`)] : null
  }

  if (trace.stage === 'rotation') return trace.children.every((action) => hasValues(action, ['rotation-damage'])) && typeof trace.value === 'number' && Math.abs(trace.value - trace.children.reduce((total, action) => total + number(find(action, 'rotation-damage')), 0)) < 1e-6 ? [line('Rotation damage', value(trace), trace.children.length ? trace.children.map((action) => value(find(action, 'rotation-damage'))).join(' + ') : '0')] : null

  const result = find(trace, 'result')
  if (!result) return null
  const critRate = find(trace, 'fixed-status-crit-rate')
  const critDamage = find(trace, 'fixed-status-crit-damage')
  const crit = mode === 'critical' && critDamage ? factor(critDamage)
    : mode === 'expected' && critRate && critDamage ? `(100% + ${factor(critRate)} × (${factor(critDamage)} − 100%))` : '100%'
  const selectedLine = line(`${selected} result`, value(trace), `${crit === '100%' ? value(result) : `${value(result)} × ${crit}`}${number(triggered) ? ` + ${value(triggered)} triggered result` : ''}`)

  if (trace.stage === 'healing' || trace.stage === 'shield') return hasValues(trace, ['scaling-power', 'motion-value', 'motion-value-factor', 'flat-value', 'support-bonus-factor']) ? [
    selectedLine,
    line('Support formula', value(result), `floor((${value(find(trace, 'scaling-power'))} × ${factor(find(trace, 'motion-value'))} × ${factor(find(trace, 'motion-value-factor'))} + ${value(find(trace, 'flat-value'))}) × ${factor(find(trace, 'support-bonus-factor'))})`)
  ] : null

  if (trace.stage === 'negative-status') return hasValues(trace, ['number:Level constant', 'motion-value', 'special-multiplier', 'defence-multiplier', 'resistance-multiplier', 'amplification-factor']) ? [selectedLine, line('Status damage', value(result), `max(0, ${value(find(trace, 'number:Level constant'))} × ${factor(find(trace, 'motion-value'))} × ${[find(trace, 'special-multiplier'), find(trace, 'defence-multiplier'), find(trace, 'resistance-multiplier'), find(trace, 'amplification-factor')].map(factor).join(' × ')})`)] : null

  if (trace.stage === 'tune-break') return hasValues(trace, ['number:Tune base value', 'number:Base multiplier', 'percent:Tune Break Boost', 'bonus-factor', 'special-multiplier', 'defence-multiplier', 'resistance-multiplier', 'vulnerability-factor', 'final-damage-factor', 'damage-reduction-factor']) ? [selectedLine, line('Tune Break damage', value(result), `max(0, ${value(find(trace, 'number:Tune base value'))} × ${value(find(trace, 'number:Base multiplier'))} × (100% + ${factor(find(trace, 'percent:Tune Break Boost'))}) × ${['bonus-factor', 'special-multiplier', 'defence-multiplier', 'resistance-multiplier', 'vulnerability-factor', 'final-damage-factor', 'damage-reduction-factor'].map((stage) => factor(find(trace, stage))).join(' × ')})`)] : null

  if (trace.stage === 'tune-amp') {
    if (!hasValues(trace, ['number:Enemy Cost', 'number:Tune level value', 'motion-value', 'percent:Tune Break Boost', 'bonus-factor', 'special-multiplier', 'defence-multiplier', 'resistance-multiplier', 'vulnerability-factor', 'final-damage-factor', 'damage-reduction-factor'])) return null
    const cost = number(find(trace, 'number:Enemy Cost'))
    const costFactor = cost === 1 ? 1 : cost === 3 ? 3 : 14
    return [selectedLine, line('Tune AMP damage', value(result), `max(0, ${value(find(trace, 'number:Tune level value'))} × ${costFactor} × ${factor(find(trace, 'motion-value'))} × (100% + ${factor(find(trace, 'percent:Tune Break Boost'))}) × ${['bonus-factor', 'special-multiplier', 'defence-multiplier', 'resistance-multiplier', 'vulnerability-factor', 'final-damage-factor', 'damage-reduction-factor'].map((stage) => factor(find(trace, stage))).join(' × ')})`)]
  }
  return null
}

import { describe, expect, it } from 'vitest'
import { hasConditionalStatLines, skillTreeStatLine } from './passive-stats'

describe('passive stat display helpers', () => {
  it('detects conditional stat wording without executing it', () => {
    const description = 'Max HP is increased by 12%. 15s after casting Intro Skill, ATK is increased by 20% for 10s.'
    expect(hasConditionalStatLines(description)).toBe(true)
  })

  it('parses fixed skill-tree stat nodes', () => {
    expect(skillTreeStatLine('Crit. Rate Bonus', 'Crit. Rate is increased by 2.8%.')).toEqual({ key:'critRate', value:2.8 })
  })
})

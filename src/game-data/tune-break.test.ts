import { describe, expect, it } from 'vitest'
import { baseTuneBreakBoost } from './tune-break'

const character = (name: string) => ({ skillTreeExtras: { tuneBreakSkill: { name } } })

describe('base Tune Break Boost', () => {
  it('is zero for generic weapon Tune Break actions', () => {
    expect(baseTuneBreakBoost(character('Tune Break: Pistols'))).toBe(0)
    expect(baseTuneBreakBoost(character('Tune Break - Sword'))).toBe(0)
  })

  it('is ten for characters with a dedicated Tune Break skill', () => {
    expect(baseTuneBreakBoost(character('Unlanded Melody'))).toBe(10)
    expect(baseTuneBreakBoost(character('Spectral Analysis'))).toBe(10)
  })
})

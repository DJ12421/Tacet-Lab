import { expect, it } from 'vitest'
import { assembledRegionalText } from './recognize'
import { parseEchoText } from './parser'
import { regionsForLayout } from './regions'
import type { CalibrationProfile } from './types'

it.each(['echo-detail', 'echo-management'] as const)('labels isolated numeric OCR in %s', async (layout) => {
  const profile = { regions: regionsForLayout(layout) } as CalibrationProfile
  const text = assembledRegionalText(profile, new Map([
    ['echo-name', 'Cyan-Feathered Heron'], ['level', '+25'], ['cost', '3'],
    ['main-stat-label', 'Fusion DMG Bonus'], ['main-stat-value', '30.0%']
  ]))
  const candidate = await parseEchoText(text, 'data:image/png;base64,numeric-regions', 'screenshot')
  expect(candidate.fields.level.value).toBe(25)
  expect(candidate.fields.cost.value).toBe(3)
})

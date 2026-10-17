import { describe, expect, it } from 'vitest'
import { createCalibrationProfile, parseCalibrationProfile } from './calibration'
import { buildCardFormat } from './build-card-formats'

describe('WuWaFlex calibration defaults', () => {
  it('recognizes older size-specific profile names after the labels become uniform', () => {
    const profile = createCalibrationProfile(2724, 1272, { x: 0, y: 0, width: 1, height: 1 }, 'build-card', 1, 'wuwaflex-1272')
    expect(parseCalibrationProfile(JSON.stringify({ ...profile, buildCardFormat: undefined, name: 'WuWaFlex (2724×1272) build card' })).buildCardFormat).toBe('wuwaflex-1272')
  })

  it.each(['wuwaflex-1272', 'wuwaflex-1377'] as const)('crops icons from saved default stats in %s without moving custom regions', (format) => {
    const profile = createCalibrationProfile(2724, format === 'wuwaflex-1272' ? 1272 : 1377,
      { x: 0, y: 0, width: 1, height: 1 }, 'build-card', 1, format)
    const current = profile.regions.find((region) => region.id === 'echo-0-stats')!.rect
    const custom = profile.regions.find((region) => region.id === 'echo-1-stats')!.rect
    profile.regions = profile.regions.map((region) => region.id === 'echo-0-stats'
      ? { ...region, rect: { ...current, x: current.x - .017, width: current.width + .017 } }
      : region.id === 'echo-1-stats' ? { ...region, rect: { ...custom, x: custom.x + .005 } } : region)

    const loaded = parseCalibrationProfile(JSON.stringify(profile))
    expect(loaded.regions.find((region) => region.id === 'echo-0-stats')?.rect).toEqual(current)
    expect(loaded.regions.find((region) => region.id === 'echo-1-stats')?.rect.x).toBe(custom.x + .005)
  })

  it.each(['wuwaflex-1272', 'wuwaflex-1377'] as const)('moves the old %s sequence default onto the icon column', (format) => {
    const height = format === 'wuwaflex-1272' ? 1272 : 1377
    const profile = createCalibrationProfile(2724, height, { x: 0, y: 0, width: 1, height: 1 }, 'build-card', 1, format)
    const scale = 1272 / height
    profile.regions = profile.regions.map((region) => region.id === 'sequence'
      ? { ...region, rect: { x: .278, y: .13 * scale, width: .028, height: .372 * scale } } : region)
    expect(parseCalibrationProfile(JSON.stringify(profile)).regions.find((region) => region.id === 'sequence')?.rect)
      .toEqual(buildCardFormat(format).sequence)
  })

  it('moves old 3416x1580 defaults into the shorter card without changing custom boxes', () => {
    const profile = createCalibrationProfile(3416, 1580, { x: 0, y: 0, width: 1, height: 1 }, 'build-card', 1, 'wuwaflex')
    const custom = profile.regions.find((region) => region.id === 'echo-1-stats')!.rect
    profile.regions = profile.regions.map((region) => region.id === 'echo-1-stats'
      ? { ...region, rect: { ...custom, x: custom.x + .004 } } : region)
    const loaded = parseCalibrationProfile(JSON.stringify(profile))
    expect(loaded.buildCardFormat).toBe('wuwaflex-1580')
    expect(loaded.regions.find((region) => region.id === 'echo-0-stats')?.rect).toEqual(buildCardFormat('wuwaflex-1580').echoes[0].stats)
    expect(loaded.regions.find((region) => region.id === 'echo-1-stats')?.rect.x).toBe(custom.x + .004)
  })

  it('replaces the tall 1580 stats default while preserving a custom box', () => {
    const profile = createCalibrationProfile(3416, 1580, { x: 0, y: 0, width: 1, height: 1 }, 'build-card', 1, 'wuwaflex-1580')
    const first = profile.regions.find((region) => region.id === 'echo-0-stats')!.rect
    const second = profile.regions.find((region) => region.id === 'echo-1-stats')!.rect
    const oldLabel = profile.regions.find((region) => region.id === 'echo-0-main-stat-label')!.rect
    profile.regions = profile.regions.map((region) => region.id === 'echo-0-stats'
      ? { ...region, rect: { ...first, height: Math.min(.225 * 1600 / 1580, .995 - first.y) } }
      : region.id === 'echo-1-stats' ? { ...region, rect: { ...second, x: second.x + .004 } }
        : region.id === 'echo-0-main-stat-label' ? { ...region, rect: { ...oldLabel, x: oldLabel.x + .008, width: oldLabel.width - .008 } }
          : region)
    const loaded = parseCalibrationProfile(JSON.stringify(profile))
    expect(loaded.regions.find((region) => region.id === 'echo-0-stats')?.rect).toEqual(first)
    expect(loaded.regions.find((region) => region.id === 'echo-1-stats')?.rect.x).toBe(second.x + .004)
    expect(loaded.regions.find((region) => region.id === 'echo-0-main-stat-label')?.rect).toEqual(oldLabel)
  })

  it('does not relabel another card format solely because its dimensions match', () => {
    const profile = createCalibrationProfile(3416, 1580, { x: 0, y: 0, width: 1, height: 1 }, 'build-card', 1, 'discord-bot')
    expect(parseCalibrationProfile(JSON.stringify(profile)).buildCardFormat).toBe('discord-bot')
  })

  it('updates saved default boxes without changing a manually positioned box', () => {
    const profile = createCalibrationProfile(3416, 1600, { x: 0, y: 0, width: 1, height: 1 }, 'build-card', 1, 'wuwaflex')
    const currentMain = profile.regions.find((region) => region.id === 'echo-0-main-stat-value')!.rect
    const currentSecondMain = profile.regions.find((region) => region.id === 'echo-1-main-stat-value')!.rect
    const currentLabel = profile.regions.find((region) => region.id === 'echo-0-main-stat-label')!.rect
    const customLabel = profile.regions.find((region) => region.id === 'echo-1-main-stat-label')!.rect
    const currentStats = profile.regions.find((region) => region.id === 'echo-0-stats')!.rect
    const customStats = profile.regions.find((region) => region.id === 'echo-1-stats')!.rect
    const currentSkill = profile.regions.find((region) => region.id === 'skill-0')!.rect
    profile.regions = profile.regions.map((region) => region.id === 'echo-0-main-stat-value'
      ? { ...region, rect: { x: currentMain.x + .008, y: .72, width: .035, height: .037 } }
      : region.id === 'echo-0-main-stat-label'
        ? { ...region, rect: { ...currentLabel, x: currentLabel.x + .008, width: currentLabel.width - .008 } }
      : region.id === 'echo-1-main-stat-label'
        ? { ...region, rect: { ...customLabel, x: customLabel.x + .003 } }
      : region.id === 'echo-0-stats'
        ? { ...region, rect: { x: currentStats.x, y: .77, width: currentStats.width, height: .20 } }
      : region.id === 'echo-1-stats'
        ? { ...region, rect: { ...customStats, y: customStats.y + .004 } }
      : region.id === 'echo-1-main-stat-value'
        ? { ...region, rect: { x: currentSecondMain.x + .01, y: .688, width: .032, height: .03 } }
      : region.id === 'skill-0'
        ? { ...region, rect: { x: .69, y: .425, width: .055, height: .05 } }
        : region.id === 'skill-1'
          ? { ...region, rect: { x: .761, y: .425, width: .055, height: .05 } }
          : region)

    const loaded = parseCalibrationProfile(JSON.stringify(profile))
    expect(loaded.regions.find((region) => region.id === 'echo-0-main-stat-value')?.rect).toEqual(currentMain)
    expect(loaded.regions.find((region) => region.id === 'echo-1-main-stat-value')?.rect).toEqual(currentSecondMain)
    expect(loaded.regions.find((region) => region.id === 'echo-0-main-stat-label')?.rect).toEqual(currentLabel)
    expect(loaded.regions.find((region) => region.id === 'echo-1-main-stat-label')?.rect.x).toBe(customLabel.x + .003)
    expect(loaded.regions.find((region) => region.id === 'echo-0-stats')?.rect).toEqual(currentStats)
    expect(loaded.regions.find((region) => region.id === 'echo-1-stats')?.rect.y).toBe(customStats.y + .004)
    expect(loaded.regions.find((region) => region.id === 'skill-0')?.rect).toEqual(currentSkill)
    expect(loaded.regions.find((region) => region.id === 'skill-1')?.rect.x).toBe(.761)
  })
})

import { DEFAULT_PANEL_RECTS, defaultPanelRectForLayout, normalizeSubstatRegions, regionsForLayout } from './regions'
import type { CalibrationProfile, ScanLayout, ScanRect } from './types'
import { buildCardFormat, buildCardFormatRegions, buildCardFormats, type BuildCardFormatId } from './build-card-formats'

// v2 uses the source image's true rendered aspect ratio. Profiles created by
// the clipped v1 calibration surface used a different vertical coordinate basis.
const STORAGE_KEY = 'tacet-lab-scanner-calibration-v2'
export const SAFE_FALLBACK_PANEL: ScanRect = defaultPanelRectForLayout('echo-detail')

export function detectLayout(panel: ScanRect): ScanLayout {
  return panel.width >= .30 ? 'echo-management' : 'echo-detail'
}

export function detectRightPanel(source: CanvasImageSource, width: number, height: number): { panelRect: ScanRect; layout: ScanLayout; confidence: number } {
  const sample = document.createElement('canvas')
  sample.width = 384
  sample.height = 112
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return { panelRect: SAFE_FALLBACK_PANEL, layout: 'unknown', confidence: 0 }
  context.drawImage(source, 0, 0, width, height, 0, 0, sample.width, sample.height)
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data
  const lightness = (x: number) => {
    let total = 0
    for (let y = 12; y < sample.height - 10; y += 1) {
      const offset = (y * sample.width + x) * 4
      total += pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722
    }
    return total / (sample.height - 22)
  }
  let best = { x: 0, score: 0 }
  for (let x = Math.round(sample.width * .55); x <= Math.round(sample.width * .86); x += 1) {
    const center = (lightness(x - 1) + lightness(x) + lightness(x + 1)) / 3
    const sides = (lightness(x - 6) + lightness(x + 6)) / 2
    if (sides - center > best.score) best = { x, score: sides - center }
  }
  if (best.score < 6) return { panelRect: SAFE_FALLBACK_PANEL, layout: 'unknown', confidence: Math.max(0, best.score / 6) }
  const divider = best.x / sample.width
  const panelRect = divider < .70
    ? { x: Math.max(.60, divider + .004), y: .08, width: Math.min(.39, .99 - divider), height: .86 }
    : { x: divider + .004, y: .10, width: .986 - divider, height: .88 }
  return { panelRect, layout: detectLayout(panelRect), confidence: Math.min(.98, .6 + best.score / 30) }
}

export function profileKey(width: number, height: number, layout: ScanLayout, uiScale = 1, buildCardFormat?: BuildCardFormatId) {
  return `${width}x${height}:${layout}:${uiScale.toFixed(2)}${layout === 'build-card' ? `:${buildCardFormat ?? 'landscape-card'}` : ''}`
}

function inferredBuildCardFormat(profile: Pick<CalibrationProfile, 'layout' | 'name' | 'buildCardFormat'> & Partial<Pick<CalibrationProfile, 'sourceWidth' | 'sourceHeight'>>): BuildCardFormatId | undefined {
  if (profile.layout !== 'build-card') return undefined
  const storedFormat = buildCardFormats.find((format) => format.id === profile.buildCardFormat)?.id
  if (profile.sourceWidth === 3416 && profile.sourceHeight === 1580
    && (!storedFormat || storedFormat === 'wide-card')) return 'wide-card-1580'
  if (!storedFormat && profile.sourceWidth === 3416 && profile.sourceHeight === 1600) return 'wide-card'
  if (!storedFormat && profile.sourceWidth === 2724 && profile.sourceHeight === 1272) return 'wide-card-1272'
  if (!storedFormat && profile.sourceWidth === 2724 && profile.sourceHeight === 1377) return 'wide-card-1377'
  if (!storedFormat && profile.sourceWidth === 1920 && profile.sourceHeight === 1160) return 'horizontal-card'
  if (!storedFormat && profile.sourceWidth === 1984 && profile.sourceHeight === 1440) return 'compact-card'
  if (!storedFormat && profile.name.includes('(2724×1272)')) return 'wide-card-1272'
  if (!storedFormat && profile.name.includes('(2724×1377)')) return 'wide-card-1377'
  return storedFormat ?? buildCardFormats.find((format) => profile.name.endsWith(`${format.label} build card`))?.id ?? 'landscape-card'
}

function normalizedProfileRegions(layout: ScanLayout, input: CalibrationProfile['regions'], buildCardFormat?: BuildCardFormatId, panelRect?: ScanRect) {
  const normalized = (layout === 'build-card' ? input.map((region) => ({ ...region, rect: { ...region.rect } })) : normalizeSubstatRegions(input))
    .filter((region) => layout !== 'build-card' || (!/^echo-\d+-main-stat$/.test(region.id)
      && !(buildCardFormat?.startsWith('wide-card') && /^echo-\d+-art$/.test(region.id))))
  if (layout !== 'build-card') {
    const panel = layout === 'echo-management' ? DEFAULT_PANEL_RECTS['echo-management'] : DEFAULT_PANEL_RECTS['echo-detail']
    if (panelRect && (Object.keys(panel) as Array<keyof ScanRect>).some((key) => Math.abs(panelRect[key] - panel[key]) >= 1e-6)) return normalized
    const oldDefaults: Array<[string, ScanRect[]]> = layout === 'echo-management' ? [
      ['echo-name', [
        { x: 0.037202645494859125, y: 0, width: 0.9424581322109724, height: 0.0848 },
        { x: 0.018648315, y: 0.002004547, width: 0.926962754, height: 0.051133874 }
      ]],
      ['level', [{ x: 0.04345000882976219, y: 0.09213376797710895, width: 0.10959238383957302, height: 0.0380334319216382 }]],
      ['cost', [{ x: 0.04855090112628535, y: 0.15371033421607258, width: 0.20251765952437012, height: 0.03974953671232499 }]],
      ['rarity', [{ x: 0.038437929224550665, y: 0, width: 0.28296064378777175, height: 0.04482382820020904 }]],
      ['sonata', [{ x: 0.145, y: 0.075, width: 0.11, height: 0.075 }]],
      ['main-stat-label', [
        { x: 0.10673394454909348, y: 0.4195416417402426, width: 0.6744156414331686, height: 0.04058667132532937 },
        { x: 0.114777786, y: 0.423107042, width: 0.659173514, height: 0.04211025 }
      ]],
      ['main-stat-value', [
        { x: 0.7888109130955184, y: 0.4181002873844789, width: 0.2050195971666274, height: 0.04274863570804797 },
        { x: 0.7739513, y: 0.423107042, width: 0.2260487, height: 0.04211025 }
      ]],
      ['substats-block', [
        { x: 0.10570595175025509, y: 0.5289550241356548, width: 0.8807481138646887, height: 0.36735557071196745 },
        { x: 0.114777786, y: 0.535300779, width: 0.885222214, height: 0.36470484 }
      ]],
      ['equipped-character', [{ x: 0.10364935297464878, y: 0.9432343066672166, width: 0.8128022108743427, height: 0.04558651016310476 }]],
      ['locked', [{ x: 0.2560685729142139, y: 0.2744580554896581, width: 0.09756010370065143, height: 0.06820120716952718 }]],
      ['discarded', [{ x: 0.04110884644062475, y: 0.27589935612468025, width: 0.09550411810297464, height: 0.06603924278680859 }]]
    ] : [
      ['sonata', [{ x: 0.88, y: 0.008, width: 0.115, height: 0.065 }]],
      ['substats-block', [
        { x: 0.10249478831318715, y: 0.2099360409169144, width: 0.8469986970782968, height: 0.24650859020497576 },
        { x: 0.10249478831318715, y: 0.2099360409169144, width: 0.8655078175302193, height: 0.24650859020497576 },
        { x: 0.10249478831318715, y: 0.2099360409169144, width: 0.8469986970782968, height: 0.21 }
      ]]
    ]
    const defaults = regionsForLayout(layout)
    // Only replace exact bundled boxes; keep every user-adjusted calibration.
    return normalized.map((region) => {
      const old = oldDefaults.find(([id]) => id === region.id)?.[1]
      const current = defaults.find((entry) => entry.id === region.id)
      return old && current && old.some((rect) => (Object.keys(rect) as Array<keyof ScanRect>).every((key) => Math.abs(region.rect[key] - rect[key]) < 1e-6))
        ? { ...region, rect: { ...current.rect } } : region
    })
  }
  const defaults = buildCardFormat && buildCardFormat !== 'landscape-card' ? buildCardFormatRegions(buildCardFormat) : regionsForLayout('build-card')
  const updated = buildCardFormat === 'wide-card' ? normalized.map((region) => {
    const fallback = defaults.find((entry) => entry.id === region.id)
    if (!fallback) return region
    const skill = region.id.match(/^skill-(\d)$/)
    const previous = skill
      ? [{ x: [.69, .76, .815, .87, .94][Number(skill[1])], y: [.425, .425, .395, .425, .425][Number(skill[1])], width: .055, height: .05 }]
      : /^echo-\d+-main-stat-label$/.test(region.id)
        ? [{ ...fallback.rect, x: fallback.rect.x + .008, width: fallback.rect.width - .008 }]
        : /^echo-\d+-main-stat-value$/.test(region.id)
        ? [{ x: fallback.rect.x + .008, y: .72, width: .035, height: .037 },
          { x: fallback.rect.x + .01, y: .688, width: .032, height: .03 }]
        : /^echo-\d+-stats$/.test(region.id)
          ? [
            { x: fallback.rect.x - .02, y: .755, width: .14, height: .235 },
            { x: fallback.rect.x, y: .77, width: fallback.rect.width, height: .20 }
          ]
        : []
    return previous.some((rect) => Object.keys(rect).every((key) => Math.abs(region.rect[key as keyof ScanRect] - rect[key as keyof ScanRect]) < 1e-6))
      ? { ...region, rect: { ...fallback.rect } }
      : region
  }) : normalized
  const current = buildCardFormat === 'wide-card-1272' || buildCardFormat === 'wide-card-1377' ? updated.map((region) => {
    const scale = buildCardFormat === 'wide-card-1377' ? 1272 / 1377 : 1
    const skill = region.id.match(/^skill-([0-4])$/)
    if (skill) {
      const fallback = defaults.find((entry) => entry.id === region.id)
      const previous = { x: [.74, .79, .84, .89, .94][Number(skill[1])], y: .42 * scale, width: .05, height: .08 * scale }
      return fallback && Object.keys(previous).every((key) => Math.abs(region.rect[key as keyof ScanRect] - previous[key as keyof ScanRect]) < 1e-6)
        ? { ...region, rect: { ...fallback.rect } } : region
    }
    if (region.id === 'sequence') {
      const fallback = defaults.find((entry) => entry.id === region.id)
      const previous = { x: .278, y: .13 * scale, width: .028, height: .372 * scale }
      return fallback && Object.keys(previous).every((key) => Math.abs(region.rect[key as keyof ScanRect] - previous[key as keyof ScanRect]) < 1e-6)
        ? { ...region, rect: { ...fallback.rect } } : region
    }
    if (!/^echo-\d+-stats$/.test(region.id)) return region
    const fallback = defaults.find((entry) => entry.id === region.id)
    if (!fallback) return region
    const previous = { ...fallback.rect, x: fallback.rect.x - .017, width: fallback.rect.width + .017 }
    return Object.keys(previous).every((key) => Math.abs(region.rect[key as keyof ScanRect] - previous[key as keyof ScanRect]) < 1e-6)
      ? { ...region, rect: { ...fallback.rect } }
      : region
  }) : updated
  const oldDefaults = buildCardFormat === 'wide-card-1580' ? buildCardFormatRegions('wide-card') : []
  const heightAdjusted = buildCardFormat === 'wide-card-1580' ? current.map((region) => {
    const oldDefault = oldDefaults.find((entry) => entry.id === region.id)?.rect
    const fallback = defaults.find((entry) => entry.id === region.id)
    const tallStats = /^echo-\d+-stats$/.test(region.id) && oldDefault && fallback
      ? [{ ...fallback.rect, height: Math.min(.225 * 1600 / 1580, .995 - fallback.rect.y) }]
      : []
    const oldMain = fallback && /^echo-\d+-main-stat-label$/.test(region.id)
      ? [{ ...fallback.rect, x: fallback.rect.x + .008, width: fallback.rect.width - .008 }]
      : []
    const old1600Main = oldDefault && /^echo-\d+-main-stat-label$/.test(region.id)
      ? [{ ...oldDefault, x: oldDefault.x + .008, width: oldDefault.width - .008 }]
      : []
    const previous = oldDefault ? [oldDefault, ...tallStats, ...oldMain, ...old1600Main] : [...tallStats, ...oldMain]
    return fallback && previous.some((rect) => Object.keys(rect).every((key) => Math.abs(region.rect[key as keyof ScanRect] - rect[key as keyof ScanRect]) < 1e-6))
      ? { ...region, rect: { ...fallback.rect } } : region
  }) : current
  return [...heightAdjusted, ...defaults.filter((fallback) => !heightAdjusted.some((region) => region.id === fallback.id))]
}

function normalizedStoredProfile(profile: CalibrationProfile): CalibrationProfile {
  const buildCardFormat = inferredBuildCardFormat(profile)
  return {
    ...profile, buildCardFormat,
    id: profileKey(profile.sourceWidth, profile.sourceHeight, profile.layout, profile.uiScale, buildCardFormat),
    regions: normalizedProfileRegions(profile.layout, profile.regions ?? [], buildCardFormat, profile.panelRect)
  }
}

export function loadCalibrationProfiles(): CalibrationProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map(normalizedStoredProfile) : []
  } catch { return [] }
}

export function loadLatestCalibrationProfile() {
  return loadCalibrationProfiles().sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

export function saveCalibrationProfile(profile: CalibrationProfile) {
  const buildCardFormat = inferredBuildCardFormat(profile)
  const persisted = {
    ...profile, buildCardFormat, regions: normalizedProfileRegions(profile.layout, profile.regions, buildCardFormat, profile.panelRect),
    id: profileKey(profile.sourceWidth, profile.sourceHeight, profile.layout, profile.uiScale, buildCardFormat), updatedAt: Date.now()
  }
  const profiles = loadCalibrationProfiles().filter((entry) => entry.id !== persisted.id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...profiles, persisted]))
  return persisted
}

export function deleteCalibrationProfile(profile: CalibrationProfile) {
  const id = profileKey(profile.sourceWidth, profile.sourceHeight, profile.layout, profile.uiScale, inferredBuildCardFormat(profile))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loadCalibrationProfiles().filter((entry) => entry.id !== id)))
}

const isRect = (value: unknown): value is ScanRect => {
  if (!value || typeof value !== 'object') return false
  const rect = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]))
}

function normalizeImportedProfile(input: unknown): CalibrationProfile {
  const value = input as Partial<CalibrationProfile>
  if (!value || typeof value !== 'object'
    || (value.layout !== 'echo-detail' && value.layout !== 'echo-management' && value.layout !== 'build-card')
    || (value.buildCardFormat !== undefined && typeof value.buildCardFormat !== 'string')
    || typeof value.sourceWidth !== 'number' || !Number.isFinite(value.sourceWidth)
    || typeof value.sourceHeight !== 'number' || !Number.isFinite(value.sourceHeight)
    || typeof value.uiScale !== 'number' || !Number.isFinite(value.uiScale)
    || !isRect(value.panelRect) || !Array.isArray(value.regions)
    || value.regions.some((region) => !region || typeof region.id !== 'string' || typeof region.kind !== 'string'
      || typeof region.label !== 'string' || !isRect(region.rect)
      || !['text', 'number', 'visual'].includes(region.recognition))) {
    throw new Error('This file is not a valid Tacet Lab calibration profile.')
  }
  const now = Date.now()
  const buildCardFormat = inferredBuildCardFormat({ layout: value.layout, name: typeof value.name === 'string' ? value.name : '', buildCardFormat: value.buildCardFormat, sourceWidth: value.sourceWidth, sourceHeight: value.sourceHeight })
  return {
    ...value,
    buildCardFormat,
    id: profileKey(value.sourceWidth, value.sourceHeight, value.layout, value.uiScale, buildCardFormat),
    name: typeof value.name === 'string' ? value.name : profileName(value.sourceWidth, value.sourceHeight, value.layout, buildCardFormat),
    regions: normalizedProfileRegions(value.layout, value.regions, buildCardFormat, value.panelRect),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: now
  } as CalibrationProfile
}

export function parseCalibrationProfiles(json: string): CalibrationProfile[] {
  const parsed = JSON.parse(json) as { profiles?: unknown[] }
  const inputs = parsed && typeof parsed === 'object' && Array.isArray(parsed.profiles) ? parsed.profiles : [parsed]
  if (!inputs.length) throw new Error('This calibration bundle does not contain any profiles.')
  return inputs.map(normalizeImportedProfile)
}

export function parseCalibrationProfile(json: string): CalibrationProfile {
  return parseCalibrationProfiles(json)[0]
}

export function calibrationExportProfiles(current: CalibrationProfile) {
  const stored = loadCalibrationProfiles()
  const targets: Array<{ layout: Exclude<ScanLayout, 'unknown'>; buildCardFormat?: BuildCardFormatId }> = [
    { layout: 'echo-detail' }, { layout: 'echo-management' },
    ...buildCardFormats.map((format) => ({ layout: 'build-card' as const, buildCardFormat: format.id }))
  ]
  return targets.map(({ layout, buildCardFormat }) => {
    const matches = (profile: CalibrationProfile) => profile.layout === layout && inferredBuildCardFormat(profile) === buildCardFormat
    if (matches(current)) return current
    return stored.filter((profile) => matches(profile)
      && Math.abs(profile.sourceWidth - current.sourceWidth) <= 2
      && Math.abs(profile.sourceHeight - current.sourceHeight) <= 2
      && Math.abs(profile.uiScale - current.uiScale) <= .02)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
      ?? createCalibrationProfile(current.sourceWidth, current.sourceHeight, defaultPanelRectForLayout(layout), layout, current.uiScale, buildCardFormat)
  })
}

export function findCompatibleProfile(width: number, height: number, layout: ScanLayout, uiScale?: number, buildCardFormat?: BuildCardFormatId) {
  return loadCalibrationProfiles().filter((profile) => profile.layout === layout
    && (layout !== 'build-card' || inferredBuildCardFormat(profile) === (buildCardFormat ?? 'landscape-card'))
    && Math.abs(profile.sourceWidth - width) <= 2 && Math.abs(profile.sourceHeight - height) <= 2
    && (uiScale === undefined || Math.abs(profile.uiScale - uiScale) <= .02))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

function profileName(width: number, height: number, layout: Exclude<ScanLayout, 'unknown'>, formatId?: BuildCardFormatId) {
  const label = layout === 'echo-detail' ? 'Character Menu' : layout === 'echo-management' ? 'Backpack' : `${buildCardFormat(formatId ?? 'landscape-card').label} build card`
  return `${width}x${height} - ${label}`
}

export function createCalibrationProfile(width: number, height: number, panelRect: ScanRect, layout: Exclude<ScanLayout, 'unknown'>, uiScale = 1, buildCardFormatId?: BuildCardFormatId): CalibrationProfile {
  const now = Date.now()
  const format = layout === 'build-card' ? buildCardFormatId ?? 'landscape-card' : undefined
  return {
    id: profileKey(width, height, layout, uiScale, format), name: profileName(width, height, layout, format), buildCardFormat: format,
    layout, sourceWidth: width, sourceHeight: height, uiScale, panelRect: { ...panelRect },
    regions: format && format !== 'landscape-card' ? buildCardFormatRegions(format) : regionsForLayout(layout), createdAt: now, updatedAt: now
  }
}

export function calibrationCompatible(profile: CalibrationProfile, width: number, height: number) {
  return Math.abs(profile.sourceWidth - width) <= 2 && Math.abs(profile.sourceHeight - height) <= 2
}

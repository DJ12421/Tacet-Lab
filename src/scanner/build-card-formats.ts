import type { ScanRect, ScanRegion } from './types'

export type BuildCardFormatId = 'landscape-card' | 'wide-card' | 'wide-card-1580' | 'wide-card-1272' | 'wide-card-1377' | 'horizontal-card' | 'compact-card' | 'tacet-lab'
export type BuildCardFormatPreference = BuildCardFormatId | 'auto'

export interface BuildCardEchoLayout {
  art: ScanRect
  name?: ScanRect
  cost?: ScanRect
  sonata?: ScanRect
  stats: ScanRect
  mainStatLabel?: ScanRect
  mainStatValue?: ScanRect
}

export interface BuildCardFormat {
  id: BuildCardFormatId
  label: string
  aspectRatio: number
  character?: ScanRect
  characterLevel?: ScanRect
  sequence?: ScanRect
  weapon?: ScanRect
  weaponLevel?: ScanRect
  weaponRank?: ScanRect
  skills: ScanRect[]
  echoes: BuildCardEchoLayout[]
}

const horizontalEchoes = (
  starts: number[],
  width: number,
  layout: Omit<BuildCardEchoLayout, 'art' | 'stats'> & { artY: number; artHeight: number; statsY: number; statsHeight: number; nameY?: number; nameHeight?: number }
) => starts.map((x): BuildCardEchoLayout => ({
  art: { x, y: layout.artY, width, height: layout.artHeight },
  name: layout.nameY === undefined ? undefined : { x, y: layout.nameY, width, height: layout.nameHeight ?? .03 },
  stats: { x, y: layout.statsY, width, height: layout.statsHeight }
}))

const discordStarts = [.011, .207, .402, .596, .79]
const discordEchoes: BuildCardEchoLayout[] = discordStarts.map((x) => ({
  art: { x, y: .605, width: .108, height: .162 },
  cost: { x: x + .158, y: .615, width: .033, height: .043 },
  sonata: { x: x + .135, y: .615, width: .031, height: .045 },
  stats: { x: x + .018, y: .815, width: .174, height: .17 },
  mainStatLabel: { x: x + .018, y: .775, width: .108, height: .04 },
  mainStatValue: { x: x + .129, y: .775, width: .063, height: .04 }
}))

const wideCardStarts = [.269, .414, .56, .705, .85]
const wideCardEchoes: BuildCardEchoLayout[] = horizontalEchoes(wideCardStarts, .14, { artY: .625, artHeight: .13, nameY: .596, nameHeight: .035, statsY: .755, statsHeight: .235 })
  .map((echo, index) => ({
    ...echo,
    stats: { x: wideCardStarts[index] + .02, y: .765, width: .12, height: .225 },
    sonata: { x: wideCardStarts[index] + .113, y: .644, width: .025, height: .043 },
    mainStatLabel: { x: wideCardStarts[index] + .073, y: .696, width: .065, height: .027 },
    mainStatValue: { x: wideCardStarts[index] + .105, y: .72, width: .033, height: .037 }
  }))

const wideCardCurrentEchoes: BuildCardEchoLayout[] = [.276, .417, .561, .705, .849].map((x) => ({
  art: { x: x + .006, y: .637, width: .055, height: .13 },
  name: { x: x + .005, y: .603, width: .13, height: .03 },
  sonata: { x: x + .11, y: .65, width: .028, height: .045 },
  mainStatLabel: { x: x + .07, y: .695, width: .07, height: .04 },
  mainStatValue: { x: x + .09, y: .735, width: .05, height: .035 },
  stats: { x: x + .018, y: .775, width: .12, height: .21 }
}))

const wideCard1272 = {
  id: 'wide-card-1272', label: 'Wide card', aspectRatio: 2724 / 1272,
  character: { x: .32, y: .04, width: .16, height: .04 },
  characterLevel: { x: .32, y: .09, width: .1, height: .04 },
  sequence: { x: .291, y: .157, width: .028, height: .346 },
  weapon: { x: .036, y: .74, width: .145, height: .05 },
  weaponLevel: { x: .042, y: .79, width: .055, height: .045 },
  weaponRank: { x: .1, y: .79, width: .04, height: .045 },
  skills: [
    { x: .746, y: .458, width: .038, height: .027 },
    { x: .796, y: .431, width: .038, height: .027 },
    { x: .846, y: .413, width: .038, height: .027 },
    { x: .896, y: .431, width: .038, height: .027 },
    { x: .946, y: .458, width: .038, height: .027 }
  ],
  echoes: wideCardCurrentEchoes
} satisfies BuildCardFormat

const wideCard1377Scale = 1272 / 1377
const wideCard1377Rect = (rect: ScanRect): ScanRect => ({ ...rect, y: rect.y * wideCard1377Scale, height: rect.height * wideCard1377Scale })
const wideCard1377: BuildCardFormat = {
  ...wideCard1272, id: 'wide-card-1377', label: 'Wide card', aspectRatio: 2724 / 1377,
  character: wideCard1377Rect(wideCard1272.character),
  characterLevel: wideCard1377Rect(wideCard1272.characterLevel),
  sequence: wideCard1377Rect(wideCard1272.sequence),
  weapon: wideCard1377Rect(wideCard1272.weapon),
  weaponLevel: wideCard1377Rect(wideCard1272.weaponLevel),
  weaponRank: wideCard1377Rect(wideCard1272.weaponRank),
  skills: wideCard1272.skills.map(wideCard1377Rect),
  echoes: wideCard1272.echoes.map((echo) => ({
    art: wideCard1377Rect(echo.art),
    name: echo.name && wideCard1377Rect(echo.name),
    sonata: echo.sonata && wideCard1377Rect(echo.sonata),
    mainStatLabel: echo.mainStatLabel && wideCard1377Rect(echo.mainStatLabel),
    mainStatValue: echo.mainStatValue && wideCard1377Rect(echo.mainStatValue),
    stats: wideCard1377Rect(echo.stats)
  }))
}

const wideCard1600 = {
  id: 'wide-card', label: 'Wide card', aspectRatio: 3416 / 1600,
  character: { x: .35, y: .035, width: .16, height: .045 },
  characterLevel: { x: .35, y: .08, width: .09, height: .035 },
  sequence: { x: .278, y: .13, width: .028, height: .372 },
  weapon: { x: .125, y: .745, width: .12, height: .05 },
  weaponLevel: { x: .125, y: .795, width: .05, height: .055 },
  weaponRank: { x: .18, y: .795, width: .04, height: .055 },
  skills: [
    { x: .697, y: .45, width: .04, height: .033 }, { x: .76, y: .427, width: .04, height: .033 },
    { x: .815, y: .395, width: .04, height: .033 }, { x: .87, y: .427, width: .04, height: .033 },
    { x: .925, y: .45, width: .055, height: .033 }
  ],
  echoes: wideCardEchoes
} satisfies BuildCardFormat

const wideCard1580Rect = (rect: ScanRect): ScanRect => {
  const y = rect.y * 1600 / 1580
  return { ...rect, y, height: Math.min(rect.height * 1600 / 1580, .995 - y) }
}
const wideCard1580: BuildCardFormat = {
  ...wideCard1600, id: 'wide-card-1580', aspectRatio: 3416 / 1580,
  character: wideCard1580Rect(wideCard1600.character),
  characterLevel: wideCard1580Rect(wideCard1600.characterLevel),
  sequence: wideCard1580Rect(wideCard1600.sequence),
  weapon: wideCard1580Rect(wideCard1600.weapon),
  weaponLevel: wideCard1580Rect(wideCard1600.weaponLevel),
  weaponRank: wideCard1580Rect(wideCard1600.weaponRank),
  skills: wideCard1600.skills.map(wideCard1580Rect),
  echoes: wideCard1600.echoes.map((echo) => ({
    art: wideCard1580Rect(echo.art),
    name: echo.name && wideCard1580Rect(echo.name),
    sonata: echo.sonata && wideCard1580Rect(echo.sonata),
    stats: wideCard1580Rect({ ...echo.stats, height: .19 }),
    mainStatLabel: echo.mainStatLabel && wideCard1580Rect(echo.mainStatLabel),
    mainStatValue: echo.mainStatValue && wideCard1580Rect(echo.mainStatValue)
  }))
}

export const buildCardFormats: BuildCardFormat[] = [
  {
    id: 'landscape-card', label: 'Landscape card', aspectRatio: 16 / 9,
    character: { x: .03, y: .012, width: .19, height: .062 },
    weapon: { x: .825, y: .416, width: .15, height: .045 },
    weaponLevel: { x: .846, y: .468, width: .075, height: .043 },
    skills: [
      { x: .427, y: .304, width: .063, height: .047 },
      { x: .476, y: .535, width: .063, height: .047 },
      { x: .548, y: .166, width: .063, height: .047 },
      { x: .647, y: .304, width: .063, height: .047 },
      { x: .604, y: .535, width: .063, height: .047 }
    ],
    echoes: discordEchoes
  },
  wideCard1600,
  wideCard1580,
  wideCard1272,
  wideCard1377,
  {
    id: 'horizontal-card', label: 'Horizontal card', aspectRatio: 1920 / 1160,
    weapon: { x: .21, y: .395, width: .22, height: .035 },
    weaponLevel: { x: .30, y: .4, width: .08, height: .03 },
    weaponRank: { x: .35, y: .4, width: .05, height: .03 },
    skills: [
      { x: .62, y: .42, width: .06, height: .06 }, { x: .70, y: .42, width: .06, height: .06 },
      { x: .77, y: .39, width: .06, height: .06 }, { x: .84, y: .42, width: .06, height: .06 },
      { x: .92, y: .42, width: .06, height: .06 }
    ],
    echoes: horizontalEchoes([.009, .205, .402, .599, .796], .195, { artY: .57, artHeight: .105, nameY: .56, nameHeight: .035, statsY: .675, statsHeight: .22 })
  },
  {
    id: 'compact-card', label: 'Compact card', aspectRatio: 1984 / 1440,
    character: { x: .015, y: .545, width: .18, height: .045 },
    characterLevel: { x: .09, y: .59, width: .08, height: .035 },
    weapon: { x: .085, y: .635, width: .17, height: .04 },
    weaponLevel: { x: .09, y: .67, width: .07, height: .03 },
    weaponRank: { x: .13, y: .67, width: .04, height: .03 },
    skills: [],
    echoes: [
      { x: .778, y: .025, width: .195, height: .305 }, { x: .778, y: .345, width: .195, height: .305 },
      { x: .35, y: .67, width: .19, height: .3 }, { x: .56, y: .67, width: .19, height: .3 },
      { x: .778, y: .67, width: .195, height: .3 }
    ].map((rect): BuildCardEchoLayout => ({
      art: { x: rect.x, y: rect.y, width: rect.width * .28, height: rect.height * .28 },
      name: { x: rect.x + rect.width * .12, y: rect.y + .015, width: rect.width * .65, height: .035 },
      stats: { x: rect.x + .01, y: rect.y + rect.height * .29, width: rect.width - .02, height: rect.height * .68 }
    }))
  },
  {
    id: 'tacet-lab', label: 'Tacet Lab', aspectRatio: 16 / 9,
    character: { x: .022, y: .025, width: .16, height: .045 },
    characterLevel: { x: .022, y: .065, width: .07, height: .03 },
    weapon: { x: .115, y: .505, width: .12, height: .04 },
    weaponLevel: { x: .115, y: .565, width: .08, height: .03 },
    weaponRank: { x: .165, y: .565, width: .04, height: .03 },
    skills: [
      { x: .32, y: .82, width: .055, height: .05 }, { x: .45, y: .82, width: .055, height: .05 },
      { x: .54, y: .79, width: .055, height: .05 }, { x: .63, y: .82, width: .055, height: .05 },
      { x: .68, y: .82, width: .055, height: .05 }
    ],
    echoes: [.142, .288, .435, .582, .73].map((y): BuildCardEchoLayout => ({
      art: { x: .755, y: y + .008, width: .075, height: .12 },
      cost: { x: .818, y: y + .105, width: .02, height: .025 },
      sonata: { x: .755, y: y + .005, width: .025, height: .025 },
      stats: { x: .83, y, width: .155, height: .14 }
    }))
  }
]

export function buildCardFormat(id: BuildCardFormatId) {
  return buildCardFormats.find((format) => format.id === id) ?? buildCardFormats[0]
}

export function buildCardFormatRegions(id: BuildCardFormatId): ScanRegion[] {
  const format = buildCardFormat(id)
  const regions: ScanRegion[] = []
  const add = (regionId: string, label: string, rect: ScanRect | undefined, recognition: ScanRegion['recognition'], kind: ScanRegion['kind'], index?: number) => {
    if (rect) regions.push({ id: regionId, label, rect: { ...rect }, recognition, kind, index })
  }

  add('character', 'Character', format.character, 'text', 'name')
  add('character-level', 'Character level', format.characterLevel, 'number', 'level')
  add('sequence', 'Sequence icons', format.sequence, 'visual', 'name')
  add('weapon', 'Weapon', format.weapon, 'text', 'name')
  add('weapon-level', 'Weapon level', format.weaponLevel, 'number', 'level')
  add('weapon-rank', 'Weapon rank', format.weaponRank, 'number', 'level')
  format.skills.forEach((rect, index) => add(`skill-${index}`, ['Normal Attack', 'Resonance Skill', 'Forte Circuit', 'Resonance Liberation', 'Intro Skill'][index] ?? `Skill ${index + 1}`, rect, 'number', 'level', index))
  format.echoes.forEach((echo, index) => {
    const label = `Echo ${index + 1}`
    if (!id.startsWith('wide-card')) add(`echo-${index}-art`, `${label} art`, echo.art, 'visual', 'name', index)
    add(`echo-${index}-name`, `${label} name`, echo.name, 'text', 'name', index)
    add(`echo-${index}-cost`, `${label} cost`, echo.cost, 'number', 'cost', index)
    add(`echo-${index}-sonata`, `${label} Sonata`, echo.sonata, 'visual', 'sonata', index)
    add(`echo-${index}-main-stat-label`, `${label} main stat label`, echo.mainStatLabel, 'text', 'main-stat-label', index)
    add(`echo-${index}-main-stat-value`, `${label} main stat value`, echo.mainStatValue, 'number', 'main-stat-value', index)
    add(`echo-${index}-stats`, `${label} stats`, echo.stats, 'text', 'substats-block', index)
  })
  return regions
}

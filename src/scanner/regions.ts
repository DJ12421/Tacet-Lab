import type { ScanLayout, ScanRect, ScanRegion } from './types'

const region = (id: string, kind: ScanRegion['kind'], label: string, rect: ScanRect, recognition: ScanRegion['recognition'], index?: number): ScanRegion => ({ id, kind, label, rect, recognition, index })

// Source-image-relative panel defaults. Edit these separately from the
// panel-relative field boxes below.
export const DEFAULT_PANEL_RECTS: Record<Exclude<ScanLayout, 'unknown'>, ScanRect> = {
  'echo-detail': { x: 0.7814648090309528, y: 0.12119504852729009, width: 0.18818307539319679, height: 0.7792011904489758 }, // Character Menu
  'echo-management': { x: 0.6795682336434711, y: 0.11407459372205966, width: 0.29127383898363207, height: 0.7388013943499553 }, // Backpack
  'build-card': { x: 0, y: 0, width: 1, height: 1 }
}

export function defaultPanelRectForLayout(layout: Exclude<ScanLayout, 'unknown'>) {
  return { ...DEFAULT_PANEL_RECTS[layout] }
}

export const SUBSTAT_BLOCK_ID = 'substats-block'

export function substatBlockFromRegions(regions: ScanRegion[]): ScanRegion | undefined {
  const configured = regions.find((entry) => entry.kind === 'substats-block' || entry.id === SUBSTAT_BLOCK_ID)
  if (configured) return { ...configured, id: SUBSTAT_BLOCK_ID, kind: 'substats-block', label: 'Substats block', rect: { ...configured.rect }, recognition: 'text' }
  const rows = regions.filter((entry) => entry.kind === 'substat-row').sort((left, right) => left.rect.y - right.rect.y)
  if (!rows.length) return
  const left = Math.min(...rows.map((entry) => entry.rect.x)), top = rows[0].rect.y
  const right = Math.max(...rows.map((entry) => entry.rect.x + entry.rect.width))
  const configuredBottom = Math.max(...rows.map((entry) => entry.rect.y + entry.rect.height))
  const rowStep = rows.length > 1 ? Math.max(...rows.slice(1).map((entry, index) => entry.rect.y - rows[index].rect.y)) : rows[0].rect.height
  const bottom = Math.min(1, configuredBottom + Math.max(rows[0].rect.height, rowStep))
  return region(SUBSTAT_BLOCK_ID, 'substats-block', 'Substats block', { x: left, y: top, width: right - left, height: bottom - top }, 'text')
}

export function normalizeSubstatRegions(regions: ScanRegion[]) {
  const block = substatBlockFromRegions(regions)
  if (!block) return regions.map((entry) => ({ ...entry, rect: { ...entry.rect } }))
  const firstIndex = regions.findIndex((entry) => entry.kind === 'substats-block' || entry.kind === 'substat-row')
  const remaining = regions.filter((entry) => entry.kind !== 'substats-block' && entry.kind !== 'substat-row').map((entry) => ({ ...entry, rect: { ...entry.rect } }))
  remaining.splice(Math.max(0, firstIndex), 0, block)
  return remaining
}

// Default calibration boxes for the Character Menu layout.
const CHARACTER_MENU_REGIONS: ScanRegion[] = [
  region('echo-name', 'name', 'Echo name', { x: 0, y: 0, width: 0.7702441368523355, height: 0.06092530316069473 }, 'text'),
  region('level', 'level', 'Level', { x: 0.7757026058434064, y: 0.017978524487560633, width: 0.1192, height: 0.0367 }, 'number'),
  region('cost', 'cost', 'Cost', { x: 0.018259667132357407, y: 0.06466804364373077, width: 0.2406, height: 0.0314 }, 'number'),
  region('rarity', 'rarity', 'Rarity', { x: 0.002745439774038753, y: 0.01645107377562197, width: 0.3196, height: 0.0422 }, 'visual'),
  region('sonata', 'sonata', 'Sonata icon', { x: 0.88, y: 0.008, width: 0.115, height: 0.065 }, 'visual'),
  region('main-stat-label', 'main-stat-label', 'Main stat label', { x: 0.10054153100892911, y: 0.12402959826318259, width: 0.6583, height: 0.0293 }, 'text'),
  region('main-stat-value', 'main-stat-value', 'Main stat value', { x: 0.7805026058434064, y: 0.12357852448756063, width: 0.1875, height: 0.028 }, 'number'),
  region(SUBSTAT_BLOCK_ID, 'substats-block', 'Substats block', { x: 0.10249478831318715, y: 0.2099360409169144, width: 0.8469986970782968, height: 0.24650859020497576 }, 'text'),
  region('equipped-character', 'equipped-character', 'Equipped character', { x: 0.109, y: 0.96, width: 0.8245, height: 0.0372 }, 'text'),
  region('locked', 'locked', 'Locked icon', { x: 0.892653257304258, y: 0.059880672038804574, width: 0.1038, height: 0.0426 }, 'visual'),
  region('discarded', 'discarded', 'Discarded icon', { x: 0.6634973941565936, y: 0.059576376936316705, width: 0.10375195438255481, height: 0.0439 }, 'visual'),
]

// Default calibration boxes for the Backpack layout.
const BACKPACK_REGIONS: ScanRegion[] = [
  region('echo-name', 'name', 'Echo name', { x: 0.037202645494859125, y: 0, width: 0.9424581322109724, height: 0.0848 }, 'text'),
  region('level', 'level', 'Level', { x: 0.04345000882976219, y: 0.09213376797710895, width: 0.10959238383957302, height: 0.0380334319216382 }, 'number'),
  region('cost', 'cost', 'Cost', { x: 0.04855090112628535, y: 0.15371033421607258, width: 0.20251765952437012, height: 0.03974953671232499 }, 'number'),
  region('rarity', 'rarity', 'Rarity', { x: 0.038437929224550665, y: 0, width: 0.28296064378777175, height: 0.04482382820020904 }, 'visual'),
  region('sonata', 'sonata', 'Sonata icon', { x: 0.145, y: 0.075, width: 0.11, height: 0.075 }, 'visual'),
  region('main-stat-label', 'main-stat-label', 'Main stat label', { x: 0.10673394454909348, y: 0.4195416417402426, width: 0.6744156414331686, height: 0.04058667132532937 }, 'text'),
  region('main-stat-value', 'main-stat-value', 'Main stat value', { x: 0.7888109130955184, y: 0.4181002873844789, width: 0.2050195971666274, height: 0.04274863570804797 }, 'number'),
  region(SUBSTAT_BLOCK_ID, 'substats-block', 'Substats block', { x: 0.10570595175025509, y: 0.5289550241356548, width: 0.8807481138646887, height: 0.36735557071196745 }, 'text'),
  region('equipped-character', 'equipped-character', 'Equipped character', { x: 0.10364935297464878, y: 0.9432343066672166, width: 0.8128022108743427, height: 0.04558651016310476 }, 'text'),
  region('locked', 'locked', 'Locked icon', { x: 0.2560685729142139, y: 0.2744580554896581, width: 0.09756010370065143, height: 0.06820120716952718 }, 'visual'),
  region('discarded', 'discarded', 'Discarded icon', { x: 0.04110884644062475, y: 0.27589935612468025, width: 0.09550411810297464, height: 0.06603924278680859 }, 'visual')
]

const BUILD_CARD_REGIONS: ScanRegion[] = [
  region('character', 'name', 'Character', { x: .032560351133869785, y: .01265024790701455, width: .26860872705399597, height: .0668706679773226 }, 'text'),
  region('character-level', 'level', 'Character level', { x: .03134882694626692, y: .012790172493497516, width: .304398065663291, height: .0653783661759327 }, 'number'),
  region('weapon', 'name', 'Weapon', { x: .8337552185728329, y: .4128871921482565, width: .13774287259395573, height: .05200421454624888 }, 'text'),
  region('weapon-level', 'level', 'Weapon level', { x: .871773088166377, y: .4705062961015607, width: .02, height: .026556475046736566 }, 'number'),
  region('skill-0', 'level', 'Normal Attack', { x: .5566303671646398, y: .16723695821141182, width: .04375052971550384, height: .030867073198610095 }, 'number', 0),
  region('skill-1', 'level', 'Resonance Skill', { x: .43564397438791597, y: .31331975686824354, width: .046225467349807974, height: .030378196628871007 }, 'number', 1),
  region('skill-2', 'level', 'Forte Circuit', { x: .6155130535759191, y: .5395985379582215, width: .05200027718087052, height: .03282257947756645 }, 'number', 2),
  region('skill-3', 'level', 'Resonance Liberation', { x: .6588841298235186, y: .31231090168556447, width: .05007528103854243, height: .03282257947756645 }, 'number', 3),
  region('skill-4', 'level', 'Intro Skill', { x: .4785246669543252, y: .5413551572787125, width: .04897539805459034, height: .03184474696212306 }, 'number', 4),
  ...[
    { art: { x: .011, y: .605, width: .09828560970504527, height: .1686851628540803 }, cost: { x: .17303122249622804, y: .6238478007142566, width: .013050475493782004, height: .028270499319271725 }, sonata: { x: .13565887196672688, y: .615, width: .031, height: .045 }, stats: { x: .029851366758869787, y: .815454213403235, width: .16530836157530174, height: .16541490896529298 }, mainLabel: { x: .11328497426075575, y: .6612672595098756, width: .0843650375908696, height: .0347675605035357 }, mainValue: { x: .16177172039308246, y: .6963349259326994, width: .03658679484615032, height: .038084840841664615 } },
    { art: { x: .207, y: .605, width: .09922571631252286, height: .16645676200672602 }, cost: { x: .36755642202359184, y: .6232078716827197, width: .012318946598390636, height: .02693182366597578 }, sonata: { x: .3307494026343416, y: .6145518555044066, width: .031, height: .046005210521249035 }, stats: { x: .22853566346241766, y: .8160322291819069, width: .16399594944449522, height: .16925178437169794 }, mainLabel: { x: .30423903671074887, y: .6645844604720393, width: .09021538099510788, height: .031080546919450544 }, mainValue: { x: .35561766783730336, y: .6977564700936764, width: .03798020737129662, height: .03487170176989352 } },
    { art: { x: .402, y: .605, width: .09985240940186083, height: .16812806264224173 }, cost: { x: .563470922440792, y: .6251482965282857, width: .012318946598390636, height: .02533960181205803 }, sonata: { x: .5260320672549379, y: .6166713006355157, width: .031, height: .045 }, stats: { x: .42240640144934166, y: .814361047610339, width: .16449842907027248, height: .17165870176481338 }, mainLabel: { x: .50157502671795, y: .6626888830468178, width: .08839439375971561, height: .037939344697431564 }, mainValue: { x: .5406703018413954, y: .6977748059416403, width: .04681389384829919, height: .032252771173697514 } },
    { art: { x: .596, y: .605, width: .10173262261681602, height: .16757096243040315 }, cost: { x: .7596772071598391, y: .6257880668078925, width: .011290683436585588, height: .023298726682516455 }, sonata: { x: .7228523647528804, y: .6133286993644843, width: .028179791800018287, height: .049456801694708605 }, stats: { x: .6178608866358816, y: .8141822929366822, width: .16352150937842902, height: .16883910872856206 }, mainLabel: { x: .700761362986924, y: .6664800378972608, width: .08450810006800931, height: .031126267475412576 }, mainValue: { x: .7365243561116954, y: .6973100596653256, width: .04559939157370153, height: .03160006261176143 } },
    { art: { x: .789486412428127, y: .6020233343576604, width: .10235940500411485, height: .1686851231660977 }, cost: { x: .954719135767191, y: .6251552816132244, width: .011953182150694953, height: .025328687616841414 }, sonata: { x: .9171658005955103, y: .6144428997881615, width: .031, height: .045 }, stats: { x: .8136406842938461, y: .8167805857819231, width: .16548490364392834, height: .1685496245834349 }, mainLabel: { x: .8914765374965711, y: .6655322094966675, width: .08879790014059061, height: .03182898289543202 }, mainValue: { x: .9333562194815289, y: .6972826749573275, width: .04585208980088692, height: .03000651073417054 } }
  ].flatMap(({ art, cost, sonata, stats, mainLabel, mainValue }, index) => [
    region(`echo-${index}-art`, 'name', `Echo ${index + 1} art`, art, 'visual', index),
    region(`echo-${index}-cost`, 'cost', `Echo ${index + 1} cost`, cost, 'number', index),
    region(`echo-${index}-sonata`, 'sonata', `Echo ${index + 1} Sonata`, sonata, 'visual', index),
    region(`echo-${index}-main-stat-label`, 'main-stat-label', `Echo ${index + 1} main stat label`, mainLabel, 'text', index),
    region(`echo-${index}-main-stat-value`, 'main-stat-value', `Echo ${index + 1} main stat value`, mainValue, 'number', index),
    region(`echo-${index}-stats`, 'main-stat-label', `Echo ${index + 1} substats`, stats, 'text', index)
  ])
]

export function regionsForLayout(layout: ScanLayout) {
  const regions = layout === 'build-card' ? BUILD_CARD_REGIONS : layout === 'echo-management' ? BACKPACK_REGIONS : CHARACTER_MENU_REGIONS
  return regions.map((entry) => ({ ...entry, rect: { ...entry.rect } }))
}

export const regionColor = (region: ScanRegion) => ({
  text: '#75d7c8', number: '#e8bd67', visual: '#d98ee8'
}[region.recognition])

export function absoluteRect(rect: ScanRect, width: number, height: number): ScanRect {
  return { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height }
}

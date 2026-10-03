import type { NegativeStatus } from '../../domain/combat/contract'

// Estimated values transcribed as data from the user-provided reference:
// https://github.com/ryanbenson/wuthering-waves-optimizer/blob/master/src/calculator/calculator.ts
// Confirm the status tables against the current English in-game UI before treating them as authoritative.
export const negativeStatusLevels: Readonly<Record<number, number>> = {
  1: 11, 20: 24, 40: 85, 50: 229, 60: 380, 70: 1005, 80: 2005, 90: 3674, 100: 4082
}

/** Motion values are basis points; index zero represents no applied stacks. */
export const negativeStatusMotionValues: Readonly<Record<NegativeStatus, readonly number[]>> = {
  'spectro-frazzle': [0, 3000, 5439, 7878, 10317, 12756, 15195, 17634, 20073, 22512, 24951, 33268, 41585, 49902],
  'aero-erosion': [0, 4500, 11250, 22500, 33750, 45000, 56250, 67500, 78750, 90000, 101250, 112500, 123750],
  'fusion-burst': [0, 8400, 15229, 22058, 28888, 35717, 42546, 49375, 56204, 63034, 69863, 93150, 116438, 139726],
  'electro-flare': [0, 5000, 9065, 13130, 17195, 21260, 25325, 29390, 33455, 37520, 41585, 55447, 69308, 83170],
  'glacio-chafe': [0, 2450, 4442, 6434, 8426, 10417, 12409, 14401, 16393, 18385, 20377, 27169, 33961, 40753]
}

// Character abilities can apply statuses outside their own element (Ciaccona's yellow Tonic, for example).
// characterIds also includes status consumers; applicatorIds narrows cases that cannot apply the status alone.
export const negativeStatusActions = [
  { status:'spectro-frazzle', name:'Spectro Frazzle', element:'spectro', characterIds:['1501', '1502', '1506', '1507', '1407'], applicatorIds:['1501', '1502', '1506', '1407'] },
  { status:'aero-erosion', name:'Aero Erosion', element:'aero', characterIds:['1406', '1408', '1407', '1409'], applicatorIds:['1407', '1409'] },
  { status:'fusion-burst', name:'Fusion Burst', element:'fusion', characterIds:['1210', '1211'] },
  { status:'electro-flare', name:'Electro Flare', element:'electro', characterIds:['1307', '1309', '1310', '1311'] },
  { status:'glacio-chafe', name:'Glacio Chafe', element:'glacio', characterIds:['1108', '1109', '1110'] }
] as const

export function applicableTeamStatusEffects(characterIds: readonly string[]) {
  const members = new Set(characterIds)
  const statuses = new Set<string>(negativeStatusActions.filter((action) =>
    ('applicatorIds' in action ? action.applicatorIds : action.characterIds).some((id) => members.has(id))
  ).map((action) => action.status))
  if (['1211', '1509', '1510', '1413'].some((id) => members.has(id))) statuses.add('tune-strain')
  if (['1508', '1610'].some((id) => members.has(id))) statuses.add('havoc-bane')
  if ((members.has('1406') || members.has('1408')) && ['spectro-frazzle', 'fusion-burst', 'electro-flare', 'glacio-chafe', 'havoc-bane'].some((status) => statuses.has(status))) statuses.add('aero-erosion')
  if (statuses.has('electro-flare')) statuses.add('electro-rage')
  return statuses
}

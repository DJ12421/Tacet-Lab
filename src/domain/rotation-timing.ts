import type { RotationCancel } from './types'

const cancelModes: readonly RotationCancel[] = ['normal', 'idash', 'icancel', 'jump', 'walk']
const validFrame = (value: unknown, maxFrame: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maxFrame

export function validRotationTiming(value: { cancel?: unknown; cancelFrame?: unknown; swapFrame?: unknown }, maxFrame = 36000) {
  return (value.cancel === undefined ? value.cancelFrame === undefined
    : cancelModes.includes(value.cancel as RotationCancel) && validFrame(value.cancelFrame, maxFrame))
    && (value.swapFrame === undefined || validFrame(value.swapFrame, maxFrame))
}

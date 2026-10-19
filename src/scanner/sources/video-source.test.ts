import { describe, expect, it, vi } from 'vitest'
import { LocalVideoSource } from './video-source'

describe('local video replay', () => {
  it('checks displayed frames through the trim end', async () => {
    const source = new LocalVideoSource()
    source.resetCancellation()
    let frame: ((now: number, metadata: { mediaTime: number }) => void) | undefined
    Object.defineProperty(source.video, 'requestVideoFrameCallback', { value: vi.fn((callback: (now: number, metadata: { mediaTime: number }) => void) => { frame = callback; return 1 }) })
    Object.defineProperty(source.video, 'cancelVideoFrameCallback', { value: vi.fn() })
    Object.defineProperty(source.video, 'play', { value: vi.fn(async () => undefined) })
    const onFrame = vi.fn()

    const replay = source.playThrough({ start: 0, end: 1 }, onFrame)
    await Promise.resolve()
    frame!(0, { mediaTime: 0 })
    frame!(0, { mediaTime: .5 })
    frame!(0, { mediaTime: 1 })

    await expect(replay).resolves.toBeUndefined()
    expect(onFrame.mock.calls.map(([time]) => time)).toEqual([0, .5, 1])
  })

  it('ends the replay when a scan is cancelled', async () => {
    const source = new LocalVideoSource()
    source.resetCancellation()
    Object.defineProperty(source.video, 'requestVideoFrameCallback', { value: vi.fn(() => 1) })
    Object.defineProperty(source.video, 'cancelVideoFrameCallback', { value: vi.fn() })
    Object.defineProperty(source.video, 'play', { value: vi.fn(async () => undefined) })

    const replay = source.playThrough({ start: 0, end: 1 }, vi.fn())
    await Promise.resolve()
    source.cancel()
    source.video.dispatchEvent(new Event('pause'))

    await expect(replay).rejects.toThrow('Video scan cancelled.')
  })

  it('accepts the pause event at the natural end of a video', async () => {
    const source = new LocalVideoSource()
    source.resetCancellation()
    Object.defineProperty(source.video, 'requestVideoFrameCallback', { value: vi.fn(() => 1) })
    Object.defineProperty(source.video, 'cancelVideoFrameCallback', { value: vi.fn() })
    Object.defineProperty(source.video, 'play', { value: vi.fn(async () => undefined) })

    const replay = source.playThrough({ start: 0, end: 1 }, vi.fn())
    await Promise.resolve()
    Object.defineProperty(source.video, 'ended', { value: true })
    source.video.dispatchEvent(new Event('pause'))

    await expect(replay).resolves.toBeUndefined()
  })
})

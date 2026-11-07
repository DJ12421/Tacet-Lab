import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EchoWaveform } from './EchoWaveform'

vi.mock('./usePageFocused', () => ({ usePageFocused: () => true }))

afterEach(() => vi.unstubAllGlobals())

describe('EchoWaveform', () => {
  it('does not schedule animation frames when paused', () => {
    const requestAnimationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)

    render(<EchoWaveform paused/>)

    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })
})

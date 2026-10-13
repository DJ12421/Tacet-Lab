import { describe, expect, it } from 'vitest'
import { setEchoSlot } from './echo-slots'

describe('setEchoSlot', () => {
  it('swaps an Echo with an occupied slot', () => {
    expect(setEchoSlot(['first', 'second'], 1, 'first')).toEqual(['second', 'first'])
  })

  it('moves an Echo to an empty slot without shifting the others', () => {
    expect(setEchoSlot(['first', 'second'], 3, 'first')).toEqual(['', 'second', '', 'first'])
  })
})

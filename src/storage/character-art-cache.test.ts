import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearCharacterArtwork, deleteCharacterArtwork, loadCharacterArtwork, saveCharacterArtwork } from './character-art-cache'

describe('character artwork cache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('round-trips and removes an uploaded image for one character', async () => {
    const stored = new Map<string, Response>()
    const cache = {
      match: async (request: Request) => stored.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => { stored.set(request.url, response.clone()) },
      delete: async (request: Request) => stored.delete(request.url)
    }
    vi.stubGlobal('location', new URL('https://tacet-lab.test/characters/lucy'))
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue(cache),
      delete: vi.fn().mockImplementation(async () => { stored.clear(); return true })
    })
    const artwork = new Blob(['image bytes'], { type: 'image/png' })

    await saveCharacterArtwork('owned-lucy', artwork)
    expect(await loadCharacterArtwork('owned-lucy')).toEqual(artwork)
    await deleteCharacterArtwork('owned-lucy')
    expect(await loadCharacterArtwork('owned-lucy')).toBeUndefined()
    await saveCharacterArtwork('owned-lucy', artwork)
    await clearCharacterArtwork()
    expect(await loadCharacterArtwork('owned-lucy')).toBeUndefined()
  })
})

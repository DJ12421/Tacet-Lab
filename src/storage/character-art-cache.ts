const CHARACTER_ART_CACHE = 'tacet-lab-character-art-v1'

function artworkRequest(characterId: string) {
  const origin = typeof location === 'undefined' ? 'https://tacet-lab.local' : location.origin
  return new Request(new URL(`/__tacet-local/character-art/${encodeURIComponent(characterId)}`, origin))
}

async function artworkCache() {
  if (typeof caches === 'undefined') throw new Error('Persistent image caching is unavailable in this browser.')
  return caches.open(CHARACTER_ART_CACHE)
}

export async function loadCharacterArtwork(characterId: string): Promise<Blob | undefined> {
  const response = await (await artworkCache()).match(artworkRequest(characterId))
  return response?.blob()
}

export async function saveCharacterArtwork(characterId: string, artwork: Blob) {
  if (!artwork.type.startsWith('image/')) throw new Error('Choose an image file.')
  await (await artworkCache()).put(artworkRequest(characterId), new Response(artwork, {
    headers: { 'Content-Type': artwork.type, 'Cache-Control': 'private, max-age=31536000, immutable' }
  }))
}

export async function deleteCharacterArtwork(characterId: string) {
  await (await artworkCache()).delete(artworkRequest(characterId))
}

export async function clearCharacterArtwork() {
  if (typeof caches === 'undefined') return
  await caches.delete(CHARACTER_ART_CACHE)
}

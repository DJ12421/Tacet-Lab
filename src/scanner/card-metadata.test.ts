import { expect, it } from 'vitest'
import { embedCardMetadata, readCardMetadata, type CardMetadata } from './card-metadata'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='

it('round trips a card with UTF-8 Echo text through a valid PNG metadata chunk', async () => {
  const card: CardMetadata = {
    format: 'tacet-lab-card', version: 1,
    characterCatalogId: '1403', characterLevel: 90, sequence: 2, skillLevels: [10, 9, 8, 7, 6],
    weaponCatalogId: '21040015', weaponLevel: 90, weaponRank: 1,
    echoes: [{ name: 'Écho', cost: 1, rarity: 5, level: 25, sonata: 'Lingering Tunes', mainStat: { key: 'atkPercent', value: 18 }, subStats: [{ key: 'critRate', value: 6.3 }] }]
  }
  const exported = await embedCardMetadata(png, card)
  expect(readCardMetadata(exported)).toEqual(card)
  expect(readCardMetadata(png)).toBeUndefined()
  const damaged = atob(exported.split(',')[1]).replace('1403', '1404')
  expect(() => readCardMetadata(`data:image/png;base64,${btoa(damaged)}`)).toThrow('metadata is damaged')
})

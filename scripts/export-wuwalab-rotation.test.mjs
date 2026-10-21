import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { convertRotation, exportRotation, parseRotationUrl } from './export-wuwalab-rotation.mjs'

const data = {
  meta: { id: 554, title: 'Sample', totalFrames: 120, loopFrames: 60 },
  team: [{ id: 1110, name: 'Suisui', sequence: 0, weapon: 'Sword', rank: 1, echoSet: 'Set', echoes: [{ cost: 4, name: 'Echo' }] }],
  rows: [
    { charId: 1110, skill: 'Basic: One', frame: 0 },
    { charId: 1110, skill: 'Basic: Two', frame: 60 }
  ],
  loopRange: { start: 0, end: 1 }
}
const abilities = { 1110: { abilities: [{ name: 'Basic: One', tacetActionId: '1110-1-0' }] } }

test('exports the linked loop with character Echoes and preserves unmapped attacks by name', () => {
  const result = convertRotation(data, parseRotationUrl('https://wuwalab.com/rotation/554/loop'), abilities)
  assert.equal(result.duration, 1)
  assert.equal(result.characters[0].echoes[0].name, 'Echo')
  assert.deepEqual(result.actions.map(({ attackName, attackId }) => [attackName, attackId]), [['Basic: One', '1110-1-0']])
  assert.equal(convertRotation(data, parseRotationUrl('https://wuwalab.com/rotation/554'), abilities).actions[1].attackId, null)
})

test('rejects unrelated URLs and malformed loop bounds', () => {
  assert.throws(() => parseRotationUrl('https://elsewhere.example/rotation/554/loop'))
  assert.throws(() => convertRotation({ ...data, loopRange: { start: 1, end: 3 } }, { id: 554, segment: 'loop' }, abilities))
})

test('fetches a rotation from a validated WuwaLab link for the local GUI', async () => {
  const result = await exportRotation('https://wuwalab.com/rotation/554/loop', async (url) => {
    assert.equal(url, 'https://api.wuwalab.com/api/app/rotation/554')
    return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => data }
  })
  assert.equal(result.source.segment, 'loop')
  assert.equal(result.actions[0].attackName, 'Basic: One')
  await assert.rejects(() => exportRotation('https://elsewhere.example/rotation/554', async () => { throw new Error('Network should not run') }))
})

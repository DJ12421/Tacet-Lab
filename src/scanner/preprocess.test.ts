import { afterEach, expect, it, vi } from 'vitest'
import { PreprocessClient } from './preprocess'

afterEach(() => vi.unstubAllGlobals())

it('decodes a frame once for concurrent crops and releases it afterward', async () => {
  const messages: Array<{ type: string; id?: string }> = []
  class FakeWorker {
    onmessage?: (event: MessageEvent) => void
    postMessage(message: { type: string; id?: string }) {
      messages.push(message)
      if (message.type === 'crop') queueMicrotask(() => this.onmessage?.({ data: {
        id: message.id, ok: true, bytes: new Uint8Array([1]).buffer, strategy: 'visual'
      } } as MessageEvent))
    }
    terminate() {}
  }
  const close = vi.fn()
  const fetchImage = vi.fn(async () => ({ blob: async () => new Blob(['image']) }))
  const decode = vi.fn(async () => ({ close }))
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('fetch', fetchImage)
  vi.stubGlobal('createImageBitmap', decode)
  const client = new PreprocessClient()
  const rect = { x: 0, y: 0, width: .5, height: .5 }
  await Promise.all([client.crop('data:image/png;base64,AA==', rect), client.crop('data:image/png;base64,AA==', rect)])
  client.release('data:image/png;base64,AA==')
  await Promise.resolve()
  expect(fetchImage).toHaveBeenCalledTimes(1)
  expect(decode).toHaveBeenCalledTimes(1)
  expect(messages.map((message) => message.type)).toEqual(['source', 'crop', 'crop', 'release'])
  client.terminate()
})

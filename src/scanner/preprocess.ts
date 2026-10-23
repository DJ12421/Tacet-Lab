import type { ScanRect, ScanRegion } from './types'
import { createLocalId } from '../domain/id'

type Strategy = 'name' | 'echo-name-color' | 'label' | 'text' | 'substat' | 'bright-substat' | 'bright-substat-block' | 'wide-card-name' | 'visual' | 'plain' | 'contrast'
type Pending = { resolve: (value: PreprocessedImage) => void; reject: (reason: Error) => void }
export interface PreprocessedImage { dataUrl: string; blob: Blob; width: number; height: number; strategy: Strategy }

const strategyFor = (region: ScanRegion): Strategy => {
  if (region.recognition === 'visual') return 'visual'
  if (region.id === 'character-level' && region.recognition === 'text') return 'plain'
  if (region.id === 'echo-name') return 'echo-name-color'
  if (region.kind === 'name') return 'name'
  if (region.kind === 'main-stat-label') return 'label'
  if (region.kind === 'substats-block' || region.kind === 'substat-row') return 'substat'
  return 'text'
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Processed crop could not be encoded.')); reader.readAsDataURL(blob)
})

export class PreprocessClient {
  private worker?: Worker
  private pending = new Map<string, Pending>()
  private sources = new Map<string, Promise<string>>()
  private generation = 0

  private ensureWorker() {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./preprocess.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = async (event) => {
      const result = event.data as { id: string; ok: boolean; bytes?: ArrayBuffer; width?: number; height?: number; strategy?: Strategy; error?: string }
      const pending = this.pending.get(result.id); if (!pending) return
      this.pending.delete(result.id)
      if (!result.ok || !result.bytes || !result.strategy) { pending.reject(new Error(result.error ?? 'Preprocessing failed.')); return }
      const blob = new Blob([result.bytes], { type: 'image/png' })
      pending.resolve({ dataUrl: await blobToDataUrl(blob), blob, width: result.width ?? 1, height: result.height ?? 1, strategy: result.strategy })
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Preprocessing worker failed.')
      this.pending.forEach(({ reject }) => reject(error)); this.pending.clear()
    }
    return this.worker
  }

  private sourceId(imageDataUrl: string) {
    let source = this.sources.get(imageDataUrl)
    if (!source) {
      const generation = this.generation
      source = (async () => {
        const response = await fetch(imageDataUrl)
        const bitmap = await createImageBitmap(await response.blob())
        if (generation !== this.generation) { bitmap.close(); throw new Error('Preprocessing cancelled.') }
        const sourceId = createLocalId()
        this.ensureWorker().postMessage({ type: 'source', sourceId, bitmap }, [bitmap])
        return sourceId
      })()
      this.sources.set(imageDataUrl, source)
      void source.catch(() => { if (this.sources.get(imageDataUrl) === source) this.sources.delete(imageDataUrl) })
    }
    return source
  }

  async process(imageDataUrl: string, region: ScanRegion, strategy = strategyFor(region), reuseSource = true) {
    const generation = this.generation
    let sourceId: string | undefined
    let bitmap: ImageBitmap | undefined
    if (reuseSource) sourceId = await this.sourceId(imageDataUrl)
    else {
      const response = await fetch(imageDataUrl)
      bitmap = await createImageBitmap(await response.blob())
    }
    if (generation !== this.generation) { bitmap?.close(); throw new Error('Preprocessing cancelled.') }
    const id = createLocalId()
    const result = new Promise<PreprocessedImage>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    try {
      this.ensureWorker().postMessage({ type: 'crop', id, sourceId, bitmap, rect: region.rect, strategy }, bitmap ? [bitmap] : [])
    } catch (error) {
      const pending = this.pending.get(id)
      this.pending.delete(id)
      bitmap?.close()
      pending?.reject(error instanceof Error ? error : new Error('Preprocessing failed.'))
    }
    return result
  }

  async crop(imageDataUrl: string, rect: ScanRect, reuseSource = true) {
    const region: ScanRegion = { id: 'crop', kind: 'name', label: 'Crop', rect, recognition: 'visual' }
    return this.process(imageDataUrl, region, 'visual', reuseSource)
  }

  release(imageDataUrl: string) {
    const source = this.sources.get(imageDataUrl)
    if (!source) return
    this.sources.delete(imageDataUrl)
    void source.then((sourceId) => this.worker?.postMessage({ type: 'release', sourceId })).catch(() => {})
  }

  terminate() {
    this.generation += 1
    this.worker?.terminate(); this.worker = undefined
    this.sources.clear()
    const error = new Error('Preprocessing cancelled.')
    this.pending.forEach(({ reject }) => reject(error)); this.pending.clear()
  }
}

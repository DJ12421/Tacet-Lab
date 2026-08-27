import type { ScanRect, ScanRegion } from './types'
import { createLocalId } from '../domain/id'

type Strategy = 'name' | 'label' | 'text' | 'substat' | 'visual' | 'plain'
type Pending = { resolve: (value: PreprocessedImage) => void; reject: (reason: Error) => void }
export interface PreprocessedImage { dataUrl: string; blob: Blob; width: number; height: number; strategy: Strategy }

const strategyFor = (region: ScanRegion): Strategy => {
  if (region.recognition === 'visual') return 'visual'
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

  async process(imageDataUrl: string, region: ScanRegion) {
    const response = await fetch(imageDataUrl)
    const bitmap = await createImageBitmap(await response.blob())
    const id = createLocalId()
    const result = new Promise<PreprocessedImage>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.ensureWorker().postMessage({ id, bitmap, rect: region.rect, strategy: strategyFor(region) }, [bitmap])
    return result
  }

  async crop(imageDataUrl: string, rect: ScanRect) {
    const region: ScanRegion = { id: 'crop', kind: 'name', label: 'Crop', rect, recognition: 'visual' }
    return this.process(imageDataUrl, region)
  }

  terminate() {
    this.worker?.terminate(); this.worker = undefined
    const error = new Error('Preprocessing cancelled.')
    this.pending.forEach(({ reject }) => reject(error)); this.pending.clear()
  }
}

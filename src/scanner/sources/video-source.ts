import { captureSourceDataUrl } from '../frame'

export interface VideoTrim { start: number; end: number; fps: 1 | 2 | 5 | 10 }

const waitFor = (target: EventTarget, eventName: string) => new Promise<void>((resolve, reject) => {
  const success = () => { cleanup(); resolve() }, failure = () => { cleanup(); reject(new Error('The local video could not be decoded.')) }
  const cleanup = () => { target.removeEventListener(eventName, success); target.removeEventListener('error', failure) }
  target.addEventListener(eventName, success, { once: true }); target.addEventListener('error', failure, { once: true })
})

export class LocalVideoSource {
  readonly video = document.createElement('video')
  private objectUrl?: string
  cancelled = false

  async open(file: File) {
    if (!file.type.startsWith('video/')) throw new Error('Choose a local video file.')
    this.close(); this.objectUrl = URL.createObjectURL(file); this.video.src = this.objectUrl; this.video.muted = true; this.video.preload = 'auto'
    await waitFor(this.video, 'loadedmetadata')
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor(this.video, 'loadeddata')
    if (!Number.isFinite(this.video.duration) || this.video.duration <= 0 || !this.video.videoWidth || !this.video.videoHeight) throw new Error('The local video has no scannable frames.')
    this.resetCancellation()
    return { duration: this.video.duration, width: this.video.videoWidth, height: this.video.videoHeight }
  }

  async seek(time: number) {
    if (this.cancelled) throw new Error('Video scan cancelled.')
    if (Math.abs(this.video.currentTime - time) > .002) { this.video.currentTime = Math.max(0, Math.min(this.video.duration, time)); await waitFor(this.video, 'seeked') }
    if (this.cancelled) throw new Error('Video scan cancelled.')
  }

  capture() { return captureSourceDataUrl(this.video, this.video.videoWidth, this.video.videoHeight, .9) }

  cancel() { this.cancelled = true; this.video.pause() }
  resetCancellation() { this.cancelled = false }
  close() { this.cancel(); if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = undefined; this.video.removeAttribute('src'); this.video.load() }
}

export function videoSampleTimes(trim: VideoTrim) {
  const start = Math.max(0, trim.start), end = Math.max(start, trim.end), step = 1 / trim.fps
  const count = Math.max(0, Math.floor((end - start) / step) + 1)
  return Array.from({ length: count }, (_, index) => Math.min(end, start + index * step))
}

import { captureSourceDataUrl } from '../frame'

export interface VideoTrim { start: number; end: number }

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
    this.close(); this.objectUrl = URL.createObjectURL(file); this.video.src = this.objectUrl; this.video.muted = true; this.video.playsInline = true; this.video.preload = 'auto'
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

  async playThrough(trim: VideoTrim, onFrame: (time: number) => void) {
    await this.seek(trim.start)
    if (!this.video.requestVideoFrameCallback) throw new Error('Video replay requires a current Chrome or Edge browser.')
    await new Promise<void>((resolve, reject) => {
      let callbackId: number | undefined
      const cleanup = () => {
        if (callbackId !== undefined) this.video.cancelVideoFrameCallback(callbackId)
        this.video.removeEventListener('ended', finish)
        this.video.removeEventListener('error', onError)
        this.video.removeEventListener('pause', onPause)
      }
      const finish = () => { cleanup(); this.video.pause(); resolve() }
      const fail = (error: unknown) => { cleanup(); this.video.pause(); reject(error instanceof Error ? error : new Error('Video replay stopped.')) }
      const onError = () => fail(new Error('The local video could not be decoded.'))
      const onPause = () => {
        if (this.cancelled) fail(new Error('Video scan cancelled.'))
        else if (this.video.ended || this.video.currentTime >= trim.end) finish()
        else fail(new Error('Video replay stopped.'))
      }
      const frame = (_now: number, metadata: { mediaTime: number }) => {
        if (this.cancelled) { onPause(); return }
        if (metadata.mediaTime > trim.end) { finish(); return }
        try { onFrame(metadata.mediaTime) } catch (error) { fail(error); return }
        if (metadata.mediaTime >= trim.end) finish()
        else callbackId = this.video.requestVideoFrameCallback(frame)
      }
      this.video.addEventListener('ended', finish, { once: true })
      this.video.addEventListener('error', onError, { once: true })
      this.video.addEventListener('pause', onPause, { once: true })
      callbackId = this.video.requestVideoFrameCallback(frame)
      try { void this.video.play().catch(fail) } catch (error) { fail(error) }
    })
  }

  capture() { return captureSourceDataUrl(this.video, this.video.videoWidth, this.video.videoHeight, .9) }

  cancel() { this.cancelled = true; this.video.pause() }
  resetCancellation() { this.cancelled = false }
  close() { this.cancel(); if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = undefined; this.video.removeAttribute('src'); this.video.load() }
}

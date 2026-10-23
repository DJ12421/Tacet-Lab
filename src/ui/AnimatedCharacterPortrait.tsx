import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { AtlasAttachmentLoader, SkeletonBinary, Spine, TextureAtlas, type SkeletonData } from '@pixi-spine/all-4.1'
import { Application, Assets, BaseTexture } from 'pixi.js'

type PortraitStatus = 'idle' | 'loading' | 'ready' | 'error' | 'reduced-motion'

// These source textures are 2048px squares, while their atlases were authored
// against smaller canvases. Match the source viewer by restoring the authored
// atlas dimensions before the Spine runtime creates its mesh regions.
const NORMALIZED_ATLAS_FOLDERS = [
  'Portraits_Kanteleila',
  'Portraits_Female',
  'Portraits_Male',
  'Portraits_Xiangliyao',
  'Portraits_Zanni'
]

interface AnimatedCharacterPortraitProps {
  skeletonSourceUrl: string
  atlasSourceUrl: string
  artRect: { x: number; y: number; width: number; height: number }
  renderScale?: number
  paused?: boolean
  onReady: () => void
  onFallback: () => void
}

export interface AnimatedCharacterPortraitHandle {
  captureFrame: () => string | undefined
}

interface SpineResource {
  spineData: SkeletonData
  spineAtlas?: TextureAtlas
}

function atlasPageSizes(atlasText: string) {
  const sizes = new Map<string, { width: number; height: number }>()
  for (const match of atlasText.matchAll(/(?:^|\r?\n\r?\n)([^\r\n]+)\r?\nsize:\s*(\d+)\s*,\s*(\d+)/g)) {
    sizes.set(match[1].trim(), { width: Number(match[2]), height: Number(match[3]) })
  }
  return sizes
}

function needsAtlasNormalization(atlasSourceUrl: string) {
  return NORMALIZED_ATLAS_FOLDERS.some((folder) => atlasSourceUrl.includes(`/portraits/${folder}/`))
}

function portraitResolution(renderScale: number) {
  return Math.max(.5, Math.min((window.devicePixelRatio || 1) * renderScale, 1.25))
}

export const AnimatedCharacterPortrait = forwardRef<AnimatedCharacterPortraitHandle, AnimatedCharacterPortraitProps>(function AnimatedCharacterPortrait({ skeletonSourceUrl, atlasSourceUrl, artRect, renderScale = 1, paused = false, onReady, onFallback }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | undefined>(undefined)
  const artRectRef = useRef(artRect)
  const fitPortraitRef = useRef<() => void>(() => {})
  const pausedRef = useRef(paused)
  const updatePlaybackRef = useRef<() => void>(() => {})
  const [status, setStatus] = useState<PortraitStatus>('idle')

  useLayoutEffect(() => {
    pausedRef.current = paused
    updatePlaybackRef.current()
  }, [paused])

  useImperativeHandle(ref, () => ({
    captureFrame: () => {
      const app = appRef.current
      if (!app) return
      try {
        return app.renderer.extract.canvas(app.stage, app.screen).toDataURL?.('image/png')
      } catch {
        return
      }
    }
  }), [])

  useEffect(() => {
    const app = appRef.current
    const host = hostRef.current
    if (!app || !host) return
    app.renderer.resolution = portraitResolution(renderScale)
    app.renderer.resize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1))
  }, [renderScale])

  useEffect(() => {
    artRectRef.current = artRect
    fitPortraitRef.current()
  }, [artRect])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !skeletonSourceUrl || !atlasSourceUrl) {
      setStatus('error')
      onFallback()
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStatus('reduced-motion')
      onFallback()
      return
    }

    let disposed = false
    let app: Application | undefined
    let activePortrait: Spine | undefined
    let spineAtlas: TextureAtlas | undefined
    let resizeObserver: ResizeObserver | undefined
    let intersectionObserver: IntersectionObserver | undefined
    let isIntersecting = true
    let isFocused = document.hasFocus()
    const updatePlayback = () => {
      if (!app) return
      const playing = !pausedRef.current && isIntersecting && isFocused && document.visibilityState === 'visible'
      if (activePortrait) activePortrait.state.timeScale = playing ? 1 : 0
      if (playing) app.start()
      else app.stop()
    }
    const onFocus = () => { isFocused = document.hasFocus(); updatePlayback() }
    const onBlur = () => { isFocused = false; updatePlayback() }
    const onVisibilityChange = () => {
      isFocused = document.hasFocus()
      updatePlayback()
    }
    updatePlaybackRef.current = updatePlayback
    const disposeRuntime = () => {
      updatePlaybackRef.current = () => {}
      fitPortraitRef.current = () => {}
      resizeObserver?.disconnect()
      resizeObserver = undefined
      intersectionObserver?.disconnect()
      intersectionObserver = undefined
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onFocus)
      window.removeEventListener('keydown', onFocus)
      app?.destroy(true, { children: true, texture: false, baseTexture: false })
      if (appRef.current === app) appRef.current = undefined
      app = undefined
      activePortrait = undefined
      spineAtlas?.dispose()
      spineAtlas = undefined
    }
    setStatus('loading')
    onFallback()

    void (async () => {
      try {
        const width = Math.max(host.clientWidth, 1)
        const height = Math.max(host.clientHeight, 1)
        const runtimeApp = new Application({
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          preserveDrawingBuffer: false,
          resolution: portraitResolution(renderScale)
        })
        app = runtimeApp
        appRef.current = runtimeApp
        runtimeApp.ticker.maxFPS = 30
        const canvas = runtimeApp.view as HTMLCanvasElement
        canvas.setAttribute('aria-hidden', 'true')
        host.replaceChildren(canvas)

        let resource: SpineResource
        if (needsAtlasNormalization(atlasSourceUrl)) {
          const [atlasResponse, skeletonResponse] = await Promise.all([
            fetch(atlasSourceUrl),
            fetch(skeletonSourceUrl)
          ])
          if (!atlasResponse.ok || !skeletonResponse.ok) throw new Error('source Spine asset request failed.')
          const atlasText = await atlasResponse.text()
          const pageSizes = atlasPageSizes(atlasText)
          const normalizedAtlas = await new Promise<TextureAtlas>((resolve, reject) => {
            new TextureAtlas(atlasText, (pagePath, loaded) => {
              void (async () => {
                const textureResponse = await fetch(new URL(pagePath, atlasSourceUrl))
                if (!textureResponse.ok) throw new Error(`source Spine texture request failed: ${pagePath}`)
                const bitmap = await createImageBitmap(await textureResponse.blob())
                const expected = pageSizes.get(pagePath)
                const canvas = document.createElement('canvas')
                canvas.width = expected?.width ?? bitmap.width
                canvas.height = expected?.height ?? bitmap.height
                const context = canvas.getContext('2d')
                if (!context) throw new Error('A canvas context could not be created for the source Spine texture.')
                context.imageSmoothingEnabled = true
                context.imageSmoothingQuality = 'high'
                context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, canvas.width, canvas.height)
                bitmap.close()
                loaded(BaseTexture.from(canvas))
              })().catch(reject)
            }, resolve)
          })
          spineAtlas = normalizedAtlas
          const parser = new SkeletonBinary(new AtlasAttachmentLoader(normalizedAtlas))
          resource = {
            spineData: parser.readSkeletonData(new Uint8Array(await skeletonResponse.arrayBuffer())),
            spineAtlas: normalizedAtlas
          }
        } else {
          resource = await Assets.load<SpineResource>({
            src: skeletonSourceUrl,
            data: { spineAtlasFile: atlasSourceUrl }
          })
        }
        spineAtlas = resource.spineAtlas
        if (disposed) {
          disposeRuntime()
          return
        }

        const portrait = new Spine(resource.spineData)
        activePortrait = portrait
        portrait.autoUpdate = true
        const animation = portrait.spineData.animations.find((entry) => entry.name.toLowerCase() === 'idle')
          ?? portrait.spineData.animations[0]
        if (animation) portrait.state.setAnimation(0, animation.name, true)
        runtimeApp.stage.addChild(portrait)

        const fitPortrait = () => {
          if (disposed) return
          const width = Math.max(host.clientWidth, 1)
          const height = Math.max(host.clientHeight, 1)
          if (runtimeApp.screen.width !== width || runtimeApp.screen.height !== height) runtimeApp.renderer.resize(width, height)
          portrait.update(0)
          const bounds = portrait.getLocalBounds()
          if (!bounds.width || !bounds.height) return
          // Preserve the saved art framing inside the card-sized render window.
          const { x, y, width: artWidth, height: artHeight } = artRectRef.current
          const scale = Math.min(artWidth / bounds.width, artHeight / bounds.height) * 1.02
          const rootBone = portrait.skeleton.getRootBone()
          const rootCenterX = rootBone?.worldX
          const characterCenterX = typeof rootCenterX === 'number' && Number.isFinite(rootCenterX)
            ? rootCenterX
            : bounds.x + bounds.width / 2
          portrait.scale.set(scale)
          portrait.pivot.set(characterCenterX, bounds.y + bounds.height / 2)
          portrait.position.set(x + artWidth / 2, y + artHeight / 2)
        }
        fitPortraitRef.current = fitPortrait
        fitPortrait()
        resizeObserver = new ResizeObserver(fitPortrait)
        resizeObserver.observe(host)
        intersectionObserver = new IntersectionObserver(([entry]) => {
          isIntersecting = entry?.isIntersecting ?? false
          updatePlayback()
        })
        intersectionObserver.observe(host)
        document.addEventListener('visibilitychange', onVisibilityChange)
        window.addEventListener('focus', onFocus)
        window.addEventListener('blur', onBlur)
        window.addEventListener('pointerdown', onFocus)
        window.addEventListener('keydown', onFocus)
        updatePlayback()
        setStatus('ready')
        onReady()
      } catch (error) {
        if (disposed) return
        disposeRuntime()
        console.warn('source animated portrait could not be loaded.', error)
        host.replaceChildren()
        setStatus('error')
        onFallback()
      }
    })()

    return () => {
      disposed = true
      disposeRuntime()
    }
  }, [atlasSourceUrl, onFallback, onReady, skeletonSourceUrl])

  return <div ref={hostRef} className={`cs-live-portrait is-${status}`} data-status={status} aria-hidden="true" />
})

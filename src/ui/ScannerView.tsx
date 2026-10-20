import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import type { BuildCardDetails, Echo } from '../domain/types'
import { createLocalId } from '../domain/id'
import { echoSignature } from '../scanner/deduplication'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { candidateErrors, candidateToEcho, parseEchoText } from '../scanner/parser'
import { saveScannedCandidates, type ScanSaveProgress } from '../scanner/persistence'
import { buildCardFormats, type BuildCardFormatPreference } from '../scanner/build-card-formats'
import { StableFrameDetector } from '../scanner/stability'
import { probeEchoSubstats } from '../scanner/capture'
import { captureScreenFrame, requestScreenSource, stopScreenSource } from '../scanner/sources/screen-source'
import { readScreenshot } from '../scanner/sources/screenshot-source'
import { LocalVideoSource, type VideoTrim } from '../scanner/sources/video-source'
import { prepareScanFrame } from '../scanner/frame'
import { createCalibrationProfile, findCompatibleProfile, loadLatestCalibrationProfile } from '../scanner/calibration'
import { ScanSessionController } from '../scanner/session'
import { copyDiagnosticReport } from '../scanner/debug'
import type { CalibrationProfile, DiagnosticScanCandidate, OcrWorkerPreference, ScanSession, ScanSource } from '../scanner/types'
import { EchoMiniCard, EquippedCharacterLabel, FilterChips, Icon, PageHeader, Panel, SingleSelect } from './components'
import { weaponStatIconSource } from './stat-icons'
import { ScanReviewCard } from './ScanReviewCard'
import { ScannerDebugOverlay } from './ScannerDebugOverlay'
import { ScannerCalibration } from './ScannerCalibration'
import { confirmDiscardChanges, useUnsavedChanges } from './useUnsavedChanges'
import { ScanSessionSummary } from './ScanSessionSummary'
import { defaultPanelRectForLayout } from '../scanner/regions'
import { echoRollRating } from '../domain/echo-grade'
import { useBodyScrollLock, useDismissableLayer } from './useDismissableLayer'

const manualText = `Unknown Echo\nCost 1\n5 Star\nLv. 0\nUnknown Sonata\nATK % 18.0%`

type BuildCardReviewSection = 'character' | 'weapon' | 'echo'
const scanCardTypes = ['Character', 'Weapon', 'Echo'] as const
const SCAN_CARDS_PER_PAGE = 30
const MAX_PENDING_SCREENSHOTS = 4

function ScannedLoadoutCards({ details, showCharacter, showWeapon, onReview }: { details: BuildCardDetails; showCharacter: boolean; showWeapon: boolean; onReview: (section: BuildCardReviewSection) => void }) {
  const character = characterCatalog.find((entry) => entry.id === details.characterCatalogId)
  const weapon = weaponCatalog.find((entry) => entry.id === details.weaponCatalogId)
  return <>
    {showCharacter && <button type="button" className="scanned-loadout-card scanned-character-card" onClick={() => onReview('character')}>
      <div className="scanned-loadout-art">
        {character?.iconSourceUrl ? <img src={character.iconSourceUrl} alt=""/> : <span>?</span>}
      </div>
      <div className="scanned-loadout-copy">
        <span className="eyebrow">Scanned character</span>
        <h3>{character?.name ?? (details.character.value || 'Unknown character')}</h3>
        <p>{character ? `${character.element} · ${character.weaponType} · ${'★'.repeat(character.rarity)}` : 'Choose a character during review'}</p>
        <dl><div><dt>Level</dt><dd>{details.characterLevel.value}/90</dd></div><div><dt>Sequence</dt><dd>S{details.sequence.value}</dd></div></dl>
        <small>Review character details</small>
      </div>
    </button>}
    {showWeapon && <button type="button" className={`scanned-loadout-card scanned-weapon-card rarity-${weapon?.rarity ?? 1}`} onClick={() => onReview('weapon')}>
      <div className="scanned-loadout-art">
        {weapon?.iconSourceUrl ? <img src={weapon.iconSourceUrl} alt=""/> : <span>?</span>}
        {weapon && <i className="scanned-weapon-rarity">{'★'.repeat(weapon.rarity)}</i>}
      </div>
      <div className="scanned-loadout-copy">
        <span className="eyebrow">Scanned weapon</span>
        <h3>{weapon?.name ?? (details.weapon.value || 'Unknown weapon')}</h3>
        <p>{weapon ? <>{weapon.type}<span>·</span><img className="weapon-stat-icon" src={weaponStatIconSource(weapon.secondaryStat)} alt="" aria-hidden="true"/>{weapon.secondaryStat} {weapon.secondaryStatValue}</> : 'Choose a weapon during review'}</p>
        <dl><div><dt>Level</dt><dd>{details.weaponLevel.value}/90</dd></div><div><dt>Rank</dt><dd>R{details.weaponRank.value}</dd></div></dl>
        <small>Review weapon details</small>
      </div>
    </button>}
  </>
}

function createFeedbackAudio() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AudioContextClass ? new AudioContextClass() : undefined
}

function feedbackTone(context: AudioContext, kind: 'new' | 'duplicate' | 'error') {
  if (context.state !== 'running') return
  if (kind === 'duplicate') {
    const oscillator = context.createOscillator(), gain = context.createGain()
    oscillator.frequency.value = 420
    gain.gain.setValueAtTime(.085, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .18)
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .19)
    return
  }
  const notes = kind === 'new' ? [[520, 0, .22], [780, .11, .32]] : [[440, 0, .18], [300, .13, .29]]
  for (const [frequency, delay, duration] of notes) {
    const start = context.currentTime + delay
    const oscillator = context.createOscillator(), gain = context.createGain()
    oscillator.type = kind === 'new' ? 'sine' : 'triangle'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(.001, start)
    gain.gain.exponentialRampToValueAtTime(.15, start + .015)
    gain.gain.exponentialRampToValueAtTime(.001, start + duration)
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + duration + .01)
  }
}

export function ScannerView({ echoes, refresh, onSessionRiskChange }: { echoes: Echo[]; refresh: () => Promise<void>; onSessionRiskChange?: (atRisk: boolean) => void }) {
  const sidebarIconRoot = `${import.meta.env.BASE_URL}sidebar-icons/`
  const videoRef = useRef<HTMLVideoElement>(null), videoReplayRef = useRef<HTMLDivElement>(null), screenshotRef = useRef<HTMLInputElement>(null), videoFileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null), controllerRef = useRef<ScanSessionController | null>(null), detector = useRef(new StableFrameDetector({ stableThreshold: .01, changedThreshold: .01 }))
  const liveSubstatSample = useRef<HTMLCanvasElement | null>(null)
  const feedbackAudioRef = useRef<AudioContext | null>(null), audioFeedbackRef = useRef(true)
  const imageScanningRef = useRef(false)
  const lastLiveEchoRef = useRef('')
  const candidateTabsRef = useRef<HTMLDivElement>(null)
  const scansRef = useRef<HTMLElement>(null)
  const reviewRef = useRef<HTMLElement>(null)
  const videoSource = useRef(new LocalVideoSource()), candidatesRef = useRef<DiagnosticScanCandidate[]>([]), echoesRef = useRef(echoes)
  const [streaming, setStreaming] = useState(false), [videoScanning, setVideoScanning] = useState(false), [imageScanning, setImageScanning] = useState(false)
  const [candidates, setCandidates] = useState<DiagnosticScanCandidate[]>([]), [session, setSession] = useState<ScanSession>()
  const [selectedScanTypes, setSelectedScanTypes] = useState<(typeof scanCardTypes)[number][]>([...scanCardTypes])
  const [cardPage, setCardPage] = useState(1)
  const [equippedFilter, setEquippedFilter] = useState('all')
  const [progress, setProgress] = useState(0), [status, setStatus] = useState('Idle'), [error, setError] = useState('')
  const [workerPreference, setWorkerPreference] = useState<Exclude<OcrWorkerPreference, 'auto'>>(4), [debugVisible, setDebugVisible] = useState(true)
  const [profile, setProfile] = useState<CalibrationProfile | undefined>(() => loadLatestCalibrationProfile()), [calibrationImage, setCalibrationImage] = useState(''), [calibrating, setCalibrating] = useState(false)
  const calibrationBaseline = useRef('')
  const calibrationDraft = (value: CalibrationProfile) => JSON.stringify([value.name, value.panelRect, value.regions])
  const calibrationDirty = Boolean(calibrating && profile && calibrationBaseline.current && calibrationDraft(profile) !== calibrationBaseline.current)
  useUnsavedChanges(calibrationDirty)
  const [selectedLayout, setSelectedLayout] = useState<CalibrationProfile['layout']>('build-card')
  const [audioFeedback, setAudioFeedback] = useState(true)
  const [videoTrim, setVideoTrim] = useState<VideoTrim>({ start: 0, end: 0 }), [videoDuration, setVideoDuration] = useState(0)
  const [videoPlayhead, setVideoPlayhead] = useState(0)
  const [videoEta, setVideoEta] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false), [activeReviewId, setActiveReviewId] = useState<string>()
  const [reviewSection, setReviewSection] = useState<BuildCardReviewSection>('echo')
  const [buildCardFormatPreference, setBuildCardFormatPreference] = useState<BuildCardFormatPreference>('auto')
  const [savingProgress, setSavingProgress] = useState<ScanSaveProgress>()
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  useLayoutEffect(() => {
    if (!videoDuration || streaming || !videoReplayRef.current) return
    const replay = videoSource.current.video
    videoReplayRef.current.prepend(replay)
    return () => { replay.remove() }
  }, [videoDuration, streaming])
  const closeReview = useCallback(() => { setReviewOpen(false); setReviewSection('echo') }, [])
  useDismissableLayer(reviewOpen, reviewRef, closeReview)
  useBodyScrollLock(reviewOpen)

  useEffect(() => { candidatesRef.current = candidates }, [candidates])
  useLayoutEffect(() => {
    if (!reviewOpen || candidates.length > 0) return
    setReviewOpen(false)
    setActiveReviewId(undefined)
  }, [candidates.length, reviewOpen])
  useEffect(() => { echoesRef.current = echoes }, [echoes])
  useEffect(() => {
    if (!audioFeedback || feedbackAudioRef.current?.state === 'running') return
    const unlockAudio = () => {
      const context = feedbackAudioRef.current ?? createFeedbackAudio()
      if (!context) return
      feedbackAudioRef.current = context
      void context.resume()
    }
    window.addEventListener('pointerdown', unlockAudio, { capture: true, once: true })
    window.addEventListener('keydown', unlockAudio, { capture: true, once: true })
    return () => { window.removeEventListener('pointerdown', unlockAudio, true); window.removeEventListener('keydown', unlockAudio, true) }
  }, [audioFeedback])
  useEffect(() => {
    const strip = candidateTabsRef.current
    if (!reviewOpen || !strip) return
    const captureCandidateWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      strip.scrollLeft += delta
      event.preventDefault()
      event.stopPropagation()
    }
    strip.addEventListener('wheel', captureCandidateWheel, { passive: false })
    return () => strip.removeEventListener('wheel', captureCandidateWheel)
  }, [reviewOpen, candidates.length])
  useLayoutEffect(() => {
    const strip = candidateTabsRef.current
    const activeTab = strip?.querySelector<HTMLButtonElement>('button.active')
    if (!reviewOpen || !strip || !activeTab) return
    const stripBounds = strip.getBoundingClientRect()
    const tabBounds = activeTab.getBoundingClientRect()
    strip.scrollLeft += tabBounds.left - stripBounds.left - (strip.clientWidth - activeTab.clientWidth) / 2
  }, [reviewOpen, activeReviewId, candidates.length])
  useLayoutEffect(() => { onSessionRiskChange?.(streaming || videoScanning || imageScanning || Boolean(savingProgress) || candidates.length > 0 || session?.status === 'running' || session?.status === 'stopping') })

  const acceptCandidate = (candidate: DiagnosticScanCandidate) => {
    if (candidate.source === 'screen') {
      const signature = echoSignature(candidate)
      if (candidate.duplicateOf) {
        if (signature !== lastLiveEchoRef.current && audioFeedbackRef.current && feedbackAudioRef.current) feedbackTone(feedbackAudioRef.current, 'duplicate')
        lastLiveEchoRef.current = signature
        return false
      }
      lastLiveEchoRef.current = signature
    }
    const next = [...candidatesRef.current, candidate].sort((left, right) => (left.frameSequence ?? Number.MAX_SAFE_INTEGER) - (right.frameSequence ?? Number.MAX_SAFE_INTEGER))
    candidatesRef.current = next
    setCandidates(next)
    if (audioFeedbackRef.current && feedbackAudioRef.current) feedbackTone(feedbackAudioRef.current, candidate.duplicateOf ? 'duplicate' : candidateErrors(candidate).length ? 'error' : 'new')
    return true
  }
  const toggleAudioFeedback = async (enabled: boolean) => {
    setAudioFeedback(enabled)
    audioFeedbackRef.current = enabled
    if (!enabled) return
    try {
      const context = feedbackAudioRef.current ?? createFeedbackAudio()
      if (!context) throw new Error('Audio feedback is not supported by this browser.')
      feedbackAudioRef.current = context
      await context.resume()
      feedbackTone(context, 'new')
    } catch (caught) { audioFeedbackRef.current = false; setAudioFeedback(false); setError(caught instanceof Error ? caught.message : 'Sound feedback could not start.') }
  }
  const createController = async (source: ScanSource) => {
    if (controllerRef.current) await controllerRef.current.cancel()
    const controller = new ScanSessionController(source, {
      onCandidate: acceptCandidate, onSession: setSession,
      onProgress: (value, nextStatus) => { setProgress(value); setStatus(nextStatus) },
      getEchoes: () => echoesRef.current, getPending: () => candidatesRef.current
    }, workerPreference)
    controller.setBuildCardFormatPreference(buildCardFormatPreference)
    controllerRef.current = controller
    return controller
  }

  const prepareCalibration = async (dataUrl: string, source: ScanSource, preferredProfile = profile, formatPreference = buildCardFormatPreference, layout = selectedLayout) => {
    const prepared = await prepareScanFrame(dataUrl, source, controllerRef.current?.session.id ?? createLocalId(), 0, preferredProfile, layout, formatPreference)
    calibrationBaseline.current = calibrationDraft(prepared.profile)
    setCalibrationImage(dataUrl); setProfile(prepared.profile); setSelectedLayout(prepared.profile.layout)
    return prepared.profile
  }

  useLayoutEffect(() => {
    if (!streaming) return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return
    let cancelled = false
    video.srcObject = stream
    void video.play().then(async () => {
      if (cancelled) return
      const dataUrl = captureScreenFrame(video)
      if (dataUrl) await prepareCalibration(dataUrl, 'screen')
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'The shared window preview could not start.')
    })
    return () => { cancelled = true }
  }, [streaming])

  const stopScreen = () => {
    if (streamRef.current) stopScreenSource(streamRef.current)
    streamRef.current = null; if (videoRef.current) videoRef.current.srcObject = null
    detector.current.reset(); setStreaming(false); controllerRef.current?.requestCompletion(); setStatus('Share ended')
  }
  const startScreen = async () => {
    setError('')
    try {
      const controller = await createController('screen'), stream = await requestScreenSource(); streamRef.current = stream
      stream.getVideoTracks()[0].addEventListener('ended', stopScreen)
      detector.current.reset(); lastLiveEchoRef.current = ''; setStreaming(true); setStatus('Watching for stable Echo panels'); void controller
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Window sharing was cancelled.') }
  }

  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => {
      const video = videoRef.current, controller = controllerRef.current; if (!video || !controller || !profile || profile.layout === 'build-card') return
      const sample = liveSubstatSample.current ?? (liveSubstatSample.current = document.createElement('canvas'))
      const probe = probeEchoSubstats(video, profile, sample); if (!probe || !detector.current.observe(probe)) return
      void controller.enqueue(video, 'screen', profile).catch((caught) => setError(caught instanceof Error ? caught.message : 'Live scan failed.'))
    }, 250)
    return () => window.clearInterval(timer)
  }, [streaming, profile])

  const scanCurrentFrame = async () => {
    const video = videoRef.current; if (!video?.videoWidth || !video.videoHeight) return
    const controller = controllerRef.current ?? await createController('screen'); await controller.enqueue(video, 'screen', profile)
  }
  const acceptScreenshots = async (files: File[]) => {
    if (!files.length || imageScanningRef.current) return
    videoSource.current.close(); setVideoDuration(0); setVideoPlayhead(0); setVideoEta('')
    imageScanningRef.current = true
    setError(''); setImageScanning(true)
    const existingIds = new Set(candidatesRef.current.map((candidate) => candidate.id))
    try {
      if (streaming) stopScreen()
      const controller = await createController('screenshot')
      const pending = new Set<Promise<void>>()
      const failures: string[] = []
      let queued = 0, completed = 0
      let selectedProfile = profile
      for (let index = 0; index < files.length; index += 1) {
        if (pending.size >= MAX_PENDING_SCREENSHOTS) await Promise.race(pending)
        const name = files[index].name || `Image ${index + 1}`
        try {
          const dataUrl = await readScreenshot(files[index])
          selectedProfile = await prepareCalibration(dataUrl, 'screenshot', selectedProfile)
          let task: Promise<void>
          task = controller.enqueue(dataUrl, 'screenshot', selectedProfile)
            .then((accepted) => { if (accepted) completed += 1; else failures.push(`${name}: Scan was cancelled.`) },
              (caught) => { failures.push(`${name}: ${caught instanceof Error ? caught.message : 'Scan failed.'}`) })
            .finally(() => { pending.delete(task) })
          pending.add(task)
          queued += 1
          setStatus(`Queued image ${index + 1} of ${files.length}`)
        } catch (caught) {
          failures.push(`${name}: ${caught instanceof Error ? caught.message : 'Invalid image.'}`)
        }
      }
      await Promise.all(pending)
      controller.requestCompletion()
      setStatus(queued ? `Image scan complete (${completed}/${files.length})` : 'No images scanned')
      if (failures.length) setError(failures.join(' '))
      const firstNewCandidate = candidatesRef.current.find((candidate) => !existingIds.has(candidate.id))
      if (firstNewCandidate) {
        setActiveReviewId(firstNewCandidate.id)
        setReviewSection('echo')
        setReviewOpen(true)
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Image scan failed.') }
    finally { imageScanningRef.current = false; setImageScanning(false) }
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const clipboardFiles = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
      const images = clipboardFiles.length ? clipboardFiles : Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (!images.length) return
      event.preventDefault()
      void acceptScreenshots(images)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  })
  const openVideo = async (file?: File) => {
    if (!file) return
    try {
      setError(''); setVideoDuration(0); setVideoPlayhead(0); setVideoEta('')
      if (streaming) stopScreen()
      const metadata = await videoSource.current.open(file); setVideoTrim({ start: 0, end: metadata.duration })
      await videoSource.current.seek(0)
      const preview = videoSource.current.capture()
      const layout = selectedLayout === 'build-card' ? 'echo-management' : selectedLayout
      setSelectedLayout(layout)
      await prepareCalibration(preview, 'video', undefined, buildCardFormatPreference, layout)
      setVideoDuration(metadata.duration)
      setStatus('Video ready')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid video.') }
  }
  const seekVideoPreview = (time: number) => {
    setVideoPlayhead(time)
    videoSource.current.video.currentTime = time
  }
  const scanVideo = async () => {
    setError(''); setVideoScanning(true); videoSource.current.resetCancellation()
    const stable = new StableFrameDetector({ stableThreshold: .01, changedThreshold: .01 })
    const sample = document.createElement('canvas')
    const existingIds = new Set(candidatesRef.current.map((candidate) => candidate.id))
    let controller: ScanSessionController | undefined
    try {
      const activeController = await createController('video')
      controller = activeController
      let checkedFrames = 0, captured = 0, processed = 0, replayFinished = false
      let scanError: Error | undefined
      let ocrQueue = Promise.resolve()
      setVideoPlayhead(videoTrim.start)
      await videoSource.current.playThrough(videoTrim, (time) => {
        const probe = profile && probeEchoSubstats(videoSource.current.video, profile, sample)
        if (probe && stable.observe(probe)) {
          const image = videoSource.current.capture()
          captured += 1
          ocrQueue = ocrQueue.then(async () => {
            if (scanError || activeController.session.status !== 'running') return
            try {
              if (!await activeController.enqueue(image, 'screenshot', profile)) throw new Error('A captured Echo could not be scanned.')
              processed += 1
              if (replayFinished) {
                setProgress(.5 + processed / captured / 2)
                setStatus(`Scanning captured Echoes: ${processed} of ${captured}`)
                setVideoEta(`${captured - processed} queued`)
              }
            } catch (caught) { scanError = caught instanceof Error ? caught : new Error('Echo scan failed.') }
          })
        }
        if (++checkedFrames % 12 === 0 || time >= videoTrim.end) {
          setVideoPlayhead(time)
          setProgress(Math.min(1, (time - videoTrim.start) / Math.max(.1, videoTrim.end - videoTrim.start)) / 2)
          setStatus(`Replaying video: ${captured} captured, ${processed} scanned`)
          setVideoEta(`${Math.max(0, videoTrim.end - time).toFixed(1)}s of video left · ${captured - processed} queued`)
        }
      })
      replayFinished = true
      setProgress(.5 + (captured ? processed / captured / 2 : 0))
      setStatus(`Video replay complete: ${processed} of ${captured} Echoes scanned`)
      setVideoEta(`${captured - processed} queued`)
      await ocrQueue
      if (scanError) throw scanError
      activeController.requestCompletion()
      const scanned = candidatesRef.current.filter((candidate) => !existingIds.has(candidate.id))
      const needsCorrection = scanned.filter((candidate) => candidateErrors(candidate).length).length
      setStatus(`Video scan finished: ${scanned.length} Echo${scanned.length === 1 ? '' : 'es'} found, ${needsCorrection} need correction`)
      if (!scanned.length) setError('No stable Echo panels were found. Check the trim and inventory layout, then scan again.')
      else if (needsCorrection === scanned.length) setError('Every scanned Echo needs correction. Check the inventory layout and calibration before saving.')
    } catch (caught) {
      if (controller?.session.status !== 'cancelled') {
        await controller?.cancel()
        setStatus('Video scan failed')
        setError(caught instanceof Error ? caught.message : 'Video scan failed.')
      }
    }
    finally { setVideoScanning(false); setVideoEta('') }
  }
  const cancelVideo = () => { videoSource.current.cancel(); void controllerRef.current?.cancel(); setStatus('Video scan cancelled') }

  const addManual = async () => {
    const candidate = await parseEchoText(manualText, '', 'manual') as DiagnosticScanCandidate
    setCandidates((current) => [...current, candidate])
    setActiveReviewId(candidate.id); setReviewSection('echo'); setReviewOpen(true)
  }
  const updateCandidate = (updated: DiagnosticScanCandidate) => setCandidates((current) => current.map((candidate) => {
    if (candidate.id === updated.id) return { ...updated, reviewState: candidate.reviewState === 'new' ? 'corrected' : candidate.reviewState }
    if (updated.buildCard && candidate.buildCard?.id === updated.buildCard.id) return { ...candidate, buildCard: updated.buildCard, fields: { ...candidate.fields, equippedBy: updated.buildCard.character } }
    return candidate
  }))
  const discard = (candidate: DiagnosticScanCandidate) => { controllerRef.current?.markRejected(candidate); setCandidates((current) => current.filter((item) => item.id !== candidate.id)) }
  const save = async (candidate: DiagnosticScanCandidate) => {
    const batch = candidate.buildCard ? candidates.filter((entry) => entry.buildCard?.id === candidate.buildCard?.id) : [candidate]
    if (batch.some((entry) => candidateErrors(entry).length) || savingProgress) {
      if (candidate.buildCard) setError('Review every Echo on this build card before saving it.')
      return
    }
    try {
      setError(''); setSavingProgress({ completed: 0, total: batch.length, phase: 'preparing' })
      await saveScannedCandidates(batch, setSavingProgress)
      batch.forEach((entry) => controllerRef.current?.markApproved(entry))
      const savedIds = new Set(batch.map((entry) => entry.id))
      setCandidates((current) => current.filter((item) => !savedIds.has(item.id))); await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The scan could not be saved.') }
    finally { setSavingProgress(undefined) }
  }
  const validCandidates = candidates.filter((candidate) => candidateErrors(candidate).length === 0)
  const approvableCardIds = new Set(validCandidates.filter((candidate) => candidate.buildCard && !candidate.duplicateOf
    && candidates.every((entry) => entry.buildCard?.id !== candidate.buildCard?.id || candidateErrors(entry).length === 0)).map((candidate) => candidate.buildCard!.id))
  const duplicateCardIds = new Set(validCandidates.filter((candidate) => candidate.buildCard && candidate.duplicateOf
    && candidates.every((entry) => entry.buildCard?.id !== candidate.buildCard?.id || Boolean(entry.duplicateOf) && candidateErrors(entry).length === 0)).map((candidate) => candidate.buildCard!.id))
  const approvableCandidates = validCandidates.filter((candidate) => candidate.buildCard
    ? approvableCardIds.has(candidate.buildCard.id) : !candidate.duplicateOf)
  const approvableDuplicates = validCandidates.filter((candidate) => candidate.buildCard
    ? duplicateCardIds.has(candidate.buildCard.id) : Boolean(candidate.duplicateOf))
  const duplicateCandidates = candidates.filter((candidate) => candidate.duplicateOf)
  const equippedCharacters = [...new Set(candidates.map((candidate) => candidate.fields.equippedBy.value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right))
  const hasUnassignedScans = candidates.some((candidate) => !candidate.fields.equippedBy.value.trim())
  const activeEquippedFilter = equippedFilter === 'all' || (equippedFilter === '' && hasUnassignedScans) || equippedCharacters.includes(equippedFilter) ? equippedFilter : 'all'
  const visibleCandidates = candidates.filter((candidate) => activeEquippedFilter === 'all' || candidate.fields.equippedBy.value.trim() === activeEquippedFilter)
  const showCharacters = selectedScanTypes.includes('Character'), showWeapons = selectedScanTypes.includes('Weapon'), showEchoes = selectedScanTypes.includes('Echo')
  const scannedBuildCards = visibleCandidates.flatMap((candidate) => candidate.buildCard ? [{ candidate, details: candidate.buildCard }] : [])
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.details.id === entry.details.id) === index)
  const scanCards = [
    ...scannedBuildCards.flatMap(({ candidate, details }) => [
      ...(showCharacters ? [{ kind: 'character' as const, candidate, details }] : []),
      ...(showWeapons ? [{ kind: 'weapon' as const, candidate, details }] : [])
    ]),
    ...(showEchoes ? visibleCandidates.map((candidate) => ({ kind: 'echo' as const, candidate })) : [])
  ]
  const pageCount = Math.max(1, Math.ceil(scanCards.length / SCAN_CARDS_PER_PAGE))
  const currentPage = Math.min(cardPage, pageCount)
  const pageCards = scanCards.slice((currentPage - 1) * SCAN_CARDS_PER_PAGE, currentPage * SCAN_CARDS_PER_PAGE)
  useEffect(() => { if (cardPage > pageCount) setCardPage(pageCount) }, [cardPage, pageCount])
  const changeCardPage = (page: number) => { setCardPage(page); scansRef.current?.scrollIntoView({ block: 'start' }) }
  const pagination = pageCount > 1 && <nav className="echo-pagination" aria-label="Scanned card pages">
    <span>{(currentPage - 1) * SCAN_CARDS_PER_PAGE + 1}–{Math.min(currentPage * SCAN_CARDS_PER_PAGE, scanCards.length)} <small>of {scanCards.length} cards</small></span>
    <div><button type="button" className="echo-page-arrow" disabled={currentPage === 1} onClick={() => changeCardPage(currentPage - 1)} aria-label="Previous page">‹</button>
      <label className="echo-page-select"><span className="sr-only">Page</span><select value={currentPage} onChange={(event) => changeCardPage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select><small>/ {pageCount}</small></label>
      <button type="button" className="echo-page-arrow" disabled={currentPage === pageCount} onClick={() => changeCardPage(currentPage + 1)} aria-label="Next page">›</button></div>
  </nav>
  const approveCandidates = async (batch: DiagnosticScanCandidate[]) => {
    if (!batch.length || savingProgress) return
    try {
      setError(''); setSavingProgress({ completed: 0, total: batch.length, phase: 'preparing' })
      await saveScannedCandidates(batch, setSavingProgress)
      batch.forEach((entry) => controllerRef.current?.markApproved(entry))
      const approvedIds = new Set(batch.map((candidate) => candidate.id))
      setCandidates((current) => current.filter((candidate) => !approvedIds.has(candidate.id)))
      await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The scans could not be saved.') }
    finally { setSavingProgress(undefined) }
  }
  const approveAll = () => approveCandidates(approvableCandidates)
  const approveAllDuplicates = () => approveCandidates(approvableDuplicates)
  const discardDuplicates = () => {
    if (!duplicateCandidates.length || savingProgress || !window.confirm(`Discard ${duplicateCandidates.length} duplicate scan${duplicateCandidates.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    const duplicateIds = new Set(duplicateCandidates.map((candidate) => candidate.id))
    duplicateCandidates.forEach((candidate) => controllerRef.current?.markRejected(candidate))
    setCandidates((current) => current.filter((candidate) => !duplicateIds.has(candidate.id)))
  }
  const discardAll = () => {
    if (!candidates.length || !window.confirm(`Discard all ${candidates.length} scanned Echoes? This cannot be undone.`)) return
    candidates.forEach((candidate) => controllerRef.current?.markRejected(candidate)); setCandidates([]); setReviewOpen(false); setActiveReviewId(undefined)
  }
  const rerunField = async (candidate: DiagnosticScanCandidate, regionId: string) => {
    try { const rescanned = await controllerRef.current?.rerunField(candidate, regionId); if (rescanned) updateCandidate({ ...rescanned, id: candidate.id, selected: candidate.selected }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Field retry failed.') }
  }

  useEffect(() => () => { if (streamRef.current) stopScreenSource(streamRef.current); videoSource.current.close(); void controllerRef.current?.cancel(); void feedbackAudioRef.current?.close() }, [])

  const activeReview = candidates.find((candidate) => candidate.id === activeReviewId) ?? candidates[0]
  const selectLayout = (layout: CalibrationProfile['layout']) => {
    if (!confirmDiscardChanges(calibrationDirty)) return
    setSelectedLayout(layout)
    if (!profile) return
    const format = layout === 'build-card' ? buildCardFormatPreference === 'auto' ? profile.buildCardFormat ?? 'discord-bot' : buildCardFormatPreference === 'wuwaflex' && profile.buildCardFormat?.startsWith('wuwaflex') ? profile.buildCardFormat : buildCardFormatPreference : undefined
    const next = findCompatibleProfile(profile.sourceWidth, profile.sourceHeight, layout, profile.uiScale, format)
      ?? createCalibrationProfile(profile.sourceWidth, profile.sourceHeight, defaultPanelRectForLayout(layout), layout, profile.uiScale, format)
    calibrationBaseline.current = calibrationDraft(next)
    setProfile(next)
  }
  const toggleCalibration = () => {
    if (!profile || !calibrationImage) {
      setCalibrating(false)
      setError('Share the game window or upload a screenshot or build card before calibrating the scanner.')
      return
    }
    if (calibrating && !confirmDiscardChanges(calibrationDirty)) return
    setError('')
    if (!calibrating) calibrationBaseline.current = calibrationDraft(profile)
    setCalibrating((value) => !value)
  }

  const dragImages = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'))
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) return
    event.preventDefault(); dragDepth.current += 1; setDragActive(true)
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false) }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); dragDepth.current = 0; setDragActive(false)
    const images = dragImages(event)
    if (images.length) void acceptScreenshots(images)
    else setError('Drop PNG, JPEG, or WebP images on this page.')
  }

  return <div className={`scanner-view${dragActive ? ' is-dragging' : ''}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClickCapture={(event) => { if ((event.target as Element).closest('button')) setError('') }}>
    {dragActive && <div className="scanner-drop-overlay"><Icon name="upload"/><strong>Drop images to scan</strong><span>PNG, JPEG, and WebP stay on this device</span></div>}
    <PageHeader eyebrow="Echo scanner" title="Scan Echoes. Skip the typing." description="Choose what you see in-game, then start. Everything stays on this device."/>
    <Panel className="scanner-launchpad">
      <header className="scanner-launchpad-head"><span className="eyebrow">Start here</span><span className="scanner-private-pill">Private & local</span></header>
      <div className="scanner-step">
        <h2><b>1</b><span>Choose what you’re scanning</span></h2>
        <div className="scanner-source-picker" role="group" aria-label="Scan source layout">
          {([['build-card', 'Build cards', 'Supported card formats', `${import.meta.env.BASE_URL}build-cards.webp`], ['echo-management', 'Backpack', 'Echo inventory', `${sidebarIconRoot}backpack.webp`], ['echo-detail', 'Character menu', 'Equipped Echo details', `${sidebarIconRoot}echoes.svg`]] as const).map(([layout, label, hint, iconSource]) => <button type="button" className={selectedLayout === layout ? 'active' : ''} aria-pressed={selectedLayout === layout} key={layout} onClick={() => selectLayout(layout)}><img className="scanner-source-icon" src={iconSource} alt=""/><span><strong>{label}</strong><small>{hint}</small></span><i>{selectedLayout === layout ? '✓' : ''}</i></button>)}
        </div>
        {selectedLayout === 'echo-detail' && <div className="scanner-compare-tip"><img src={`${import.meta.env.BASE_URL}scanner-comparison-view.png`} alt="Arrow pointing to the Comparison View button next to Equip"/><p><strong>Turn on Comparison View</strong><span>Use the highlighted button next to Equip before scanning for better Echo recognition.</span></p></div>}
        {selectedLayout === 'build-card' && <div className="scanner-format-row"><label className="scanner-format-select">Build card format<select value={buildCardFormatPreference} onChange={(event) => { if (!confirmDiscardChanges(calibrationDirty)) return; const value = event.target.value as BuildCardFormatPreference; setBuildCardFormatPreference(value); controllerRef.current?.setBuildCardFormatPreference(value); if (calibrationImage) void prepareCalibration(calibrationImage, 'screenshot', profile, value) }}><option value="auto">Auto detect</option>{buildCardFormats.filter((format) => !format.id.startsWith('wuwaflex-')).map((format) => <option value={format.id} key={format.id}>{format.label}</option>)}</select></label><details className="scanner-format-info"><summary aria-label="Supported build card formats">i</summary><div className="scanner-format-info-panel"><strong>Supported formats</strong><dl><dt>Discord Bot</dt><dd>16:9 aspect ratio</dd><dt>WuWaFlex</dt><dd>3416 × 1600, 3416 × 1580, 2724 × 1272, 2724 × 1377</dd><dt>WuWa Optimizer</dt><dd>1920:1160 aspect ratio</dd><dt>The WuWa Calculator</dt><dd>1984:1440 aspect ratio</dd><dt>Tacet Lab</dt><dd>16:9 aspect ratio (exports at 1920 × 1080)</dd></dl></div></details></div>}
      </div>
      <div className="scanner-step">
        <h2><b>2</b><span>Choose how to scan</span></h2>
        <div className="scanner-start-actions">
          {streaming ? <button className="danger scanner-live-action" onClick={stopScreen}><span className="scanner-action-icon"><Icon name="scan"/></span><span><strong>Stop live scan</strong><small>End window sharing</small></span></button> : <button className="primary scanner-live-action" disabled={videoScanning || imageScanning} onClick={() => void startScreen()}><span className="scanner-action-icon"><Icon name="scan"/></span><span><strong>Scan game window</strong><small>Best for multiple Echoes</small></span></button>}
          <p className="scanner-mobile-note">Live window scanning is available on laptop/pc only. Please use images, video, or manual entry on mobile.</p>
          <button className="secondary" disabled={imageScanning || videoScanning} onClick={() => screenshotRef.current?.click()}><img className="scanner-image-action-icon" src={`${sidebarIconRoot}camera.webp`} alt=""/><span><strong>{imageScanning ? 'Scanning…' : 'Use images'}</strong><small>Screenshots or build cards</small></span></button>
          <button className="secondary scanner-video-action" disabled={videoScanning || imageScanning} onClick={() => videoFileRef.current?.click()}><Icon name="upload"/><span><strong>Use a video</strong><small>Choose a local recording</small></span></button>
          <button className="secondary" onClick={() => void addManual()}><Icon name="plus"/><span><strong>Enter manually</strong><small>No image needed</small></span></button>
        </div>
      </div>
      <input ref={screenshotRef} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void acceptScreenshots(files) }}/>
      <input ref={videoFileRef} hidden type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void openVideo(file) }}/>
      {(imageScanning || videoScanning || savingProgress || status !== 'Idle') && !streaming && <div className="scanner-inline-status"><span className={`live-dot ${imageScanning || videoScanning || savingProgress ? 'on' : ''}`}/><strong>{savingProgress ? (savingProgress.phase === 'writing' ? 'Finishing save…' : `Preparing ${savingProgress.completed} of ${savingProgress.total}…`) : status}</strong>{(imageScanning || videoScanning || savingProgress) && <><div className="progress"><i style={{ width: `${savingProgress ? savingProgress.completed / Math.max(1, savingProgress.total) * 100 : progress * 100}%` }}/></div><b>{savingProgress ? `${savingProgress.completed}/${savingProgress.total}` : `${Math.round(progress * 100)}%`}</b></>}</div>}
      {error && <div className="notice error scanner-capture-error">{error}</div>}
      <div className="scanner-step scanner-final-step"><h2><b>3</b><span>Check and save</span></h2><small>Tip: paste an image directly with Ctrl+V</small></div>
      <details className="scanner-advanced">
        <summary><span><Icon name="settings"/>Advanced scanner settings</span><span className="scanner-advanced-arrow"><Icon name="chevron"/></span></summary>
        <div className="scanner-controls"><label>OCR workers<select value={workerPreference} onChange={(event) => { const value = Number(event.target.value) as 1 | 2 | 4 | 6 | 8; setWorkerPreference(value); controllerRef.current?.setWorkerPreference(value) }}><option value="1">1</option><option value="2">2</option><option value="4">4</option><option value="6">6</option><option value="8">8</option></select></label><label className="check"><input type="checkbox" checked={audioFeedback} onChange={(event) => void toggleAudioFeedback(event.target.checked)}/>Sound feedback</label><button className="secondary scanner-calibration-button" onClick={toggleCalibration}><Icon name="scan"/>{calibrating ? 'Close calibration' : 'Calibrate'}</button></div>
        <p className="scanner-setting-note">OCR workers split one scan’s text fields across CPU cores.</p>
        <ScanSessionSummary session={session}/>
      </details>
    </Panel>
    {calibrating && profile && calibrationImage && <ScannerCalibration
      key={`${profile.layout}:${profile.buildCardFormat ?? ''}`}
      imageDataUrl={calibrationImage}
      profile={profile}
      showScanBoxes={debugVisible}
      onChange={(next) => { setProfile(next); setSelectedLayout(next.layout) }}
      onShowScanBoxesChange={setDebugVisible}
      onPersisted={(saved) => { calibrationBaseline.current = calibrationDraft(saved) }}
      onSaved={(saved) => { calibrationBaseline.current = calibrationDraft(saved); setProfile(saved); setSelectedLayout(saved.layout); setError(''); setCalibrating(false); setStatus('Calibration profile saved locally') }}
    />}
    {streaming && <div className="scanner-layout scanner-layout-wide"><Panel className="capture-panel"><div className="capture-head"><div><span className="live-dot on"/><strong>Scanning live</strong></div><span>{status}</span></div><div className="video-stage active"><video ref={videoRef} muted playsInline autoPlay/>{profile && <div className="live-panel-overlay" style={{ left: `${profile.panelRect.x * 100}%`, top: `${profile.panelRect.y * 100}%`, width: `${profile.panelRect.width * 100}%`, height: `${profile.panelRect.height * 100}%` }}><ScannerDebugOverlay regions={profile.regions} visible={debugVisible}/></div>}</div><div className="capture-status"><div className="progress"><i style={{ width: `${progress * 100}%` }}/></div><span>{Math.round(progress * 100)}%</span><button className="text-button" onClick={() => void scanCurrentFrame()}>Scan now</button></div><div className="privacy-strip"><strong>Local only</strong><span>No frames leave this device.</span></div></Panel></div>}
    {videoDuration > 0 && !streaming && <Panel className="video-scan-controls">
      <header><div><span className="eyebrow">Local video scan</span><h3>Trim and detect Echoes</h3></div><span>{videoEta}</span></header>
      <div className="video-trim">
        <div className="video-timeline">
          <div className="video-timeline-track"/>
          <div className="video-timeline-selection" style={{ left: `${videoTrim.start / videoDuration * 100}%`, width: `${(videoTrim.end - videoTrim.start) / videoDuration * 100}%` }}/>
          <input className="video-playhead" type="range" aria-label="Video playhead" min="0" max={videoDuration} step=".01" value={videoPlayhead} disabled={videoScanning} onChange={(event) => seekVideoPreview(Number(event.target.value))}/>
          <input className="video-trim-start" type="range" aria-label="Trim start" min="0" max={videoDuration} step=".1" value={videoTrim.start} disabled={videoScanning} onChange={(event) => setVideoTrim((value) => ({ ...value, start: Math.min(Number(event.target.value), value.end) }))}/>
          <input className="video-trim-end" type="range" aria-label="Trim end" min="0" max={videoDuration} step=".1" value={videoTrim.end} disabled={videoScanning} onChange={(event) => setVideoTrim((value) => ({ ...value, end: Math.max(Number(event.target.value), value.start) }))}/>
        </div>
        {videoScanning ? <button className="danger" onClick={cancelVideo}>Cancel immediately</button> : <button className="primary" onClick={() => void scanVideo()}>Scan video</button>}
        <div className="video-timeline-labels"><span>Start {videoTrim.start.toFixed(1)}s</span><span>Playhead {videoPlayhead.toFixed(1)}s</span><span>End {videoTrim.end.toFixed(1)}s</span></div>
      </div>
      <small>Drag the playhead to preview a frame. Captured Echoes join the OCR queue while the video replays.</small>
      <div className="video-stage active video-replay-stage" ref={videoReplayRef} role="group" aria-label="Video scan replay">{profile && <div className="live-panel-overlay" style={{ left: `${profile.panelRect.x * 100}%`, top: `${profile.panelRect.y * 100}%`, width: `${profile.panelRect.width * 100}%`, height: `${profile.panelRect.height * 100}%` }}><ScannerDebugOverlay regions={profile.regions} visible={debugVisible}/></div>}</div>
    </Panel>}
    {candidates.length > 0 && <section className="scanned-echoes" ref={scansRef}>
      <div className="section-heading scanned-echoes-heading">
        <div><span className="eyebrow">Ready to save</span><h2>Your scans <b>{candidates.length}</b></h2></div>
        <div className="scanned-echo-filters"><FilterChips label="Scan type" values={scanCardTypes} selected={selectedScanTypes} onChange={(next) => { setSelectedScanTypes(next); setCardPage(1) }}/><div className="scanned-echo-character-filter"><span>Equipped character</span><SingleSelect label="Equipped character" value={activeEquippedFilter} options={[{ value: 'all', label: 'All characters' }, ...(hasUnassignedScans ? [{ value: '', label: 'Unassigned' }] : []), ...equippedCharacters.map((name) => ({ value: name, label: name, icon: characterCatalog.find((entry) => entry.name === name)?.iconSourceUrl }))]} onChange={(next) => { setEquippedFilter(next); setCardPage(1) }}/></div>{(visibleCandidates.length !== candidates.length || selectedScanTypes.length !== scanCardTypes.length || pageCount > 1) && <small>Bulk actions apply to all {candidates.length} scans.</small>}</div>
        <div className="scanned-echo-actions">
          <button className="primary" disabled={!approvableCandidates.length || Boolean(savingProgress)} onClick={() => void approveAll()}>{savingProgress ? 'Saving…' : 'Save all'}</button>
          <button className="secondary" disabled={!approvableDuplicates.length || Boolean(savingProgress)} onClick={() => void approveAllDuplicates()}>Save duplicates</button>
          <button className="danger" disabled={!duplicateCandidates.length || Boolean(savingProgress)} onClick={discardDuplicates}>Discard duplicates</button>
          <button className="danger" disabled={Boolean(savingProgress)} onClick={discardAll}>Discard all</button>
        </div>
      </div>
      {savingProgress && <div className="scanner-save-progress" role="status"><div className="progress"><i style={{ width: `${savingProgress.completed / Math.max(1, savingProgress.total) * 100}%` }}/></div><strong>{savingProgress.phase === 'writing' ? 'Finishing save…' : `Saving ${savingProgress.completed} of ${savingProgress.total}`}</strong></div>}
      {scanCards.length ? <>{pagination}<div className="scanned-echo-grid">{pageCards.map((card) => {
        const { candidate } = card
        if (card.kind !== 'echo') return <ScannedLoadoutCards key={`${card.details.id}:${card.kind}`} details={card.details} showCharacter={card.kind === 'character'} showWeapon={card.kind === 'weapon'} onReview={(section) => { setActiveReviewId(candidate.id); setReviewSection(section); setReviewOpen(true) }}/>
        const duplicateBadge = candidate.duplicateOf ? <span className="scan-duplicate-badge">Duplicate</span> : null
        if (candidateErrors(candidate).length > 0) return <button className={`scan-error-card${candidate.duplicateOf ? ' duplicate' : ''}`} key={candidate.id} onClick={() => { setActiveReviewId(candidate.id); setReviewSection('echo'); setReviewOpen(true) }}>{duplicateBadge}<span>Needs a check</span><strong>{candidate.fields.name.value || 'Unknown Echo'}</strong><small>{candidateErrors(candidate).join(' ')}</small></button>
        const echo = candidateToEcho(candidate)
        return <div className={`scanned-echo-card${candidate.duplicateOf ? ' duplicate' : ''}`} key={candidate.id}>{duplicateBadge}<EchoMiniCard echo={echo} rollRating={echoRollRating(echo)} equipment={<EquippedCharacterLabel name={candidate.fields.equippedBy.value}/>} onClick={() => { setActiveReviewId(candidate.id); setReviewSection('echo'); setReviewOpen(true) }}/></div>
      })}</div>{pagination}</> : <div className="empty-state compact">No scans match these filters.</div>}
    </section>}
    {reviewOpen && createPortal(<div className="modal-backdrop scan-review-backdrop" role="dialog" aria-modal="true" aria-label="Review scans"><section className="panel scan-review-popout" ref={reviewRef}><header><div><span className="eyebrow">Check before saving</span><h2>Review your scans <b>{candidates.length}</b></h2></div><button className="close" aria-label="Close review" onClick={closeReview}>×</button></header>{candidates.length > 1 && <div className="review-candidate-tabs" ref={candidateTabsRef}>{candidates.map((candidate, index) => <button className={candidate.id === activeReview?.id ? 'active' : ''} onClick={() => setActiveReviewId(candidate.id)} key={candidate.id}>{index + 1}. {candidate.fields.name.value}</button>)}</div>}<div className="scan-review-scroll">{activeReview ? <ScanReviewCard candidate={activeReview} reviewSection={reviewSection} onReviewSectionChange={setReviewSection} onChange={updateCandidate} onDiscard={() => { discard(activeReview); setActiveReviewId(undefined) }} onSave={() => { void save(activeReview); setActiveReviewId(undefined) }} onRerunField={(regionId) => void rerunField(activeReview, regionId)} onCopyDiagnostic={(includeImages) => void copyDiagnosticReport(activeReview, includeImages)}/> : <div className="empty-state compact"><h3>All done</h3><p>Close this window to scan more Echoes.</p></div>}</div></section></div>, document.body)}
  </div>
}

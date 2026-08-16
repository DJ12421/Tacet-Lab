import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BuildCardDetails, Echo } from '../domain/types'
import { createLocalId } from '../domain/id'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { candidateErrors, candidateToEcho, parseEchoText } from '../scanner/parser'
import { saveScannedCandidate } from '../scanner/persistence'
import { StableFrameDetector } from '../scanner/stability'
import { probeEchoPanel } from '../scanner/capture'
import { captureScreenFrame, requestScreenSource, stopScreenSource } from '../scanner/sources/screen-source'
import { readScreenshot } from '../scanner/sources/screenshot-source'
import { LocalVideoSource, videoSampleTimes, type VideoTrim } from '../scanner/sources/video-source'
import { prepareScanFrame } from '../scanner/frame'
import { loadLatestCalibrationProfile } from '../scanner/calibration'
import { ScanSessionController } from '../scanner/session'
import { copyDiagnosticReport } from '../scanner/debug'
import type { CalibrationProfile, DiagnosticScanCandidate, OcrWorkerPreference, ScanSession, ScanSource } from '../scanner/types'
import { EchoMiniCard, EquippedCharacterLabel, Icon, PageHeader, Panel } from './components'
import { ScanReviewCard } from './ScanReviewCard'
import { ScannerDebugOverlay } from './ScannerDebugOverlay'
import { ScannerCalibration } from './ScannerCalibration'
import { ScanSessionSummary } from './ScanSessionSummary'
import { defaultPanelRectForLayout, regionsForLayout } from '../scanner/regions'
import { echoRollRating } from '../domain/echo-grade'
import { useBodyScrollLock, useDismissableLayer } from './useDismissableLayer'

const manualText = `Unknown Echo\nCost 1\n5 Star\nLv. 0\nUnknown Sonata\nATK % 18.0%`

function ScannedLoadoutCards({ details, onReview }: { details: BuildCardDetails; onReview: () => void }) {
  const character = characterCatalog.find((entry) => entry.id === details.characterCatalogId)
  const weapon = weaponCatalog.find((entry) => entry.id === details.weaponCatalogId)
  return <>
    <button type="button" className="scanned-loadout-card scanned-character-card" onClick={onReview}>
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
    </button>
    <button type="button" className={`scanned-loadout-card scanned-weapon-card rarity-${weapon?.rarity ?? 1}`} onClick={onReview}>
      <div className="scanned-loadout-art">
        {weapon?.iconSourceUrl ? <img src={weapon.iconSourceUrl} alt=""/> : <span>?</span>}
        {weapon && <i className="scanned-weapon-rarity">{'★'.repeat(weapon.rarity)}</i>}
      </div>
      <div className="scanned-loadout-copy">
        <span className="eyebrow">Scanned weapon</span>
        <h3>{weapon?.name ?? (details.weapon.value || 'Unknown weapon')}</h3>
        <p>{weapon ? `${weapon.type} · ${weapon.secondaryStat} ${weapon.secondaryStatValue}` : 'Choose a weapon during review'}</p>
        <dl><div><dt>Level</dt><dd>{details.weaponLevel.value}/90</dd></div><div><dt>Rank</dt><dd>R1</dd></div></dl>
        <small>Review weapon details</small>
      </div>
    </button>
  </>
}

function createFeedbackAudio() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AudioContextClass ? new AudioContextClass() : undefined
}

function feedbackTone(context: AudioContext, kind: 'new' | 'duplicate' | 'error') {
  if (context.state !== 'running') return
  const oscillator = context.createOscillator(), gain = context.createGain()
  oscillator.frequency.value = kind === 'new' ? 720 : kind === 'duplicate' ? 420 : 220
  gain.gain.setValueAtTime(.085, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .18)
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .19)
}

export function ScannerView({ echoes, refresh, scanIntervalMs, onScanIntervalChange, onSessionRiskChange }: { echoes: Echo[]; refresh: () => Promise<void>; scanIntervalMs: number; onScanIntervalChange: (scanIntervalMs: number) => Promise<void>; onSessionRiskChange?: (atRisk: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null), screenshotRef = useRef<HTMLInputElement>(null), videoFileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null), controllerRef = useRef<ScanSessionController | null>(null), detector = useRef(new StableFrameDetector())
  const feedbackAudioRef = useRef<AudioContext | null>(null), audioFeedbackRef = useRef(true)
  const imageScanningRef = useRef(false)
  const candidateTabsRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLElement>(null)
  const videoSource = useRef(new LocalVideoSource()), candidatesRef = useRef<DiagnosticScanCandidate[]>([]), echoesRef = useRef(echoes)
  const [streaming, setStreaming] = useState(false), [videoScanning, setVideoScanning] = useState(false), [imageScanning, setImageScanning] = useState(false)
  const [candidates, setCandidates] = useState<DiagnosticScanCandidate[]>([]), [session, setSession] = useState<ScanSession>()
  const [progress, setProgress] = useState(0), [status, setStatus] = useState('Idle'), [error, setError] = useState('')
  const [calibrationNotice, setCalibrationNotice] = useState('')
  const [workerPreference, setWorkerPreference] = useState<OcrWorkerPreference>('auto'), [debugVisible, setDebugVisible] = useState(true)
  const [profile, setProfile] = useState<CalibrationProfile | undefined>(() => loadLatestCalibrationProfile()), [calibrationImage, setCalibrationImage] = useState(''), [calibrating, setCalibrating] = useState(false)
  const [selectedLayout, setSelectedLayout] = useState<CalibrationProfile['layout']>(() => loadLatestCalibrationProfile()?.layout ?? 'echo-detail')
  const [audioFeedback, setAudioFeedback] = useState(true)
  const [videoTrim, setVideoTrim] = useState<VideoTrim>({ start: 0, end: 0, fps: 2 }), [videoDuration, setVideoDuration] = useState(0)
  const [videoEta, setVideoEta] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false), [activeReviewId, setActiveReviewId] = useState<string>()
  const closeReview = useCallback(() => setReviewOpen(false), [])
  useDismissableLayer(reviewOpen, reviewRef, closeReview)
  useBodyScrollLock(reviewOpen)

  useEffect(() => { candidatesRef.current = candidates }, [candidates])
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
  useLayoutEffect(() => { onSessionRiskChange?.(streaming || videoScanning || imageScanning || candidates.length > 0 || session?.status === 'running' || session?.status === 'stopping') })

  const acceptCandidate = (candidate: DiagnosticScanCandidate) => {
    setCandidates((current) => {
      const next = [...current, candidate].sort((left, right) => (left.frameSequence ?? Number.MAX_SAFE_INTEGER) - (right.frameSequence ?? Number.MAX_SAFE_INTEGER))
      candidatesRef.current = next
      return next
    })
    if (audioFeedbackRef.current && feedbackAudioRef.current) feedbackTone(feedbackAudioRef.current, candidate.duplicateOf ? 'duplicate' : candidateErrors(candidate).length ? 'error' : 'new')
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
    controllerRef.current = controller
    return controller
  }

  const prepareCalibration = async (dataUrl: string, source: ScanSource, preferredProfile = profile) => {
    const prepared = await prepareScanFrame(dataUrl, source, controllerRef.current?.session.id ?? createLocalId(), 0, preferredProfile, selectedLayout)
    setCalibrationImage(dataUrl); setProfile(prepared.profile); setSelectedLayout(prepared.profile.layout)
    setCalibrationNotice(prepared.needsCalibration ? `Scan used detected defaults because no saved ${prepared.frame.width}x${prepared.frame.height} ${prepared.frame.layout} calibration matched. Review and save the panel if any fields are misplaced.` : '')
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
      detector.current.reset(); setStreaming(true); setStatus('Watching for stable Echo panels'); void controller
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Window sharing was cancelled.') }
  }

  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => {
      const video = videoRef.current, controller = controllerRef.current; if (!video || !controller) return
      const probe = probeEchoPanel(video); if (!probe || !detector.current.observe(probe.fingerprint)) return
      const dataUrl = captureScreenFrame(video); if (dataUrl) void controller.enqueue(dataUrl, 'screen', profile).catch((caught) => setError(caught instanceof Error ? caught.message : 'Live scan failed.'))
    }, scanIntervalMs)
    return () => window.clearInterval(timer)
  }, [streaming, scanIntervalMs, profile])

  const scanCurrentFrame = async () => {
    const dataUrl = videoRef.current ? captureScreenFrame(videoRef.current) : undefined; if (!dataUrl) return
    const controller = controllerRef.current ?? await createController('screen'); await controller.enqueue(dataUrl, 'screen', profile)
  }
  const acceptScreenshots = async (files: File[]) => {
    if (!files.length || imageScanningRef.current) return
    imageScanningRef.current = true
    setError(''); setImageScanning(true)
    const existingIds = new Set(candidatesRef.current.map((candidate) => candidate.id))
    try {
      if (streaming) stopScreen()
      const controller = await createController('screenshot')
      const pending: Promise<boolean>[] = []
      const pendingNames: string[] = []
      const failures: string[] = []
      let selectedProfile = profile
      for (let index = 0; index < files.length; index += 1) {
        try {
          const dataUrl = await readScreenshot(files[index])
          selectedProfile = await prepareCalibration(dataUrl, 'screenshot', selectedProfile)
          pending.push(controller.enqueue(dataUrl, 'screenshot', selectedProfile))
          pendingNames.push(files[index].name || `Image ${index + 1}`)
          setStatus(`Queued image ${index + 1} of ${files.length}`)
        } catch (caught) {
          failures.push(`${files[index].name || `Image ${index + 1}`}: ${caught instanceof Error ? caught.message : 'Invalid image.'}`)
        }
      }
      const results = await Promise.allSettled(pending)
      results.forEach((result, index) => { if (result.status === 'rejected') failures.push(`${pendingNames[index]}: ${result.reason instanceof Error ? result.reason.message : 'Scan failed.'}`) })
      controller.requestCompletion()
      setStatus(pending.length ? `Image scan complete (${pending.length - results.filter((result) => result.status === 'rejected').length}/${files.length})` : 'No images scanned')
      if (failures.length) setError(failures.join(' '))
      const firstNewCandidate = candidatesRef.current.find((candidate) => !existingIds.has(candidate.id))
      if (firstNewCandidate) {
        setActiveReviewId(firstNewCandidate.id)
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
      if (streaming) stopScreen()
      const metadata = await videoSource.current.open(file); setVideoDuration(metadata.duration); setVideoTrim({ start: 0, end: metadata.duration, fps: 2 })
      const preview = await videoSource.current.seek(0); await prepareCalibration(preview, 'video'); setStatus('Video ready')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid video.') }
  }
  const scanVideo = async () => {
    setError(''); setVideoScanning(true); videoSource.current.resetCancellation()
    const controller = await createController('video'), times = videoSampleTimes(videoTrim), started = performance.now()
    try {
      for (let index = 0; index < times.length; index += 1) {
        if (!controllerRef.current || controllerRef.current.session.id !== controller.session.id) break
        const dataUrl = await videoSource.current.seek(times[index])
        await controller.enqueue(dataUrl, 'video', profile)
        const fraction = (index + 1) / Math.max(1, times.length), elapsed = performance.now() - started
        setProgress(fraction); setStatus(`Video frame ${index + 1} of ${times.length}`); setVideoEta(`${Math.max(0, elapsed / fraction - elapsed) / 1000 < 1 ? '<1' : Math.round((elapsed / fraction - elapsed) / 1000)}s remaining`)
      }
      controller.requestCompletion(); setStatus('Video scan complete')
    } catch (caught) { if (controller.session.status !== 'cancelled') setError(caught instanceof Error ? caught.message : 'Video scan failed.') }
    finally { setVideoScanning(false) }
  }
  const cancelVideo = () => { videoSource.current.cancel(); void controllerRef.current?.cancel(); setVideoScanning(false); setStatus('Video scan cancelled') }

  const addManual = async () => {
    const candidate = await parseEchoText(manualText, '', 'manual') as DiagnosticScanCandidate
    setCandidates((current) => [...current, candidate])
    setActiveReviewId(candidate.id); setReviewOpen(true)
  }
  const updateCandidate = (updated: DiagnosticScanCandidate) => setCandidates((current) => current.map((candidate) => {
    if (candidate.id === updated.id) return { ...updated, reviewState: candidate.reviewState === 'new' ? 'corrected' : candidate.reviewState }
    if (updated.buildCard && candidate.buildCard?.id === updated.buildCard.id) return { ...candidate, buildCard: updated.buildCard, fields: { ...candidate.fields, equippedBy: updated.buildCard.character } }
    return candidate
  }))
  const discard = (candidate: DiagnosticScanCandidate) => { controllerRef.current?.markRejected(); setCandidates((current) => current.filter((item) => item.id !== candidate.id)) }
  const save = async (candidate: DiagnosticScanCandidate) => {
    if (candidateErrors(candidate).length) return
    await saveScannedCandidate(candidate); controllerRef.current?.markApproved(); setCandidates((current) => current.filter((item) => item.id !== candidate.id)); await refresh()
  }
  const validCandidates = candidates.filter((candidate) => candidateErrors(candidate).length === 0)
  const approvableCandidates = validCandidates.filter((candidate) => !candidate.duplicateOf)
  const approvableDuplicates = validCandidates.filter((candidate) => candidate.duplicateOf)
  const scannedBuildCards = candidates.flatMap((candidate) => candidate.buildCard ? [{ candidate, details: candidate.buildCard }] : [])
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.details.id === entry.details.id) === index)
  const approveCandidates = async (batch: DiagnosticScanCandidate[]) => {
    for (const candidate of batch) { await saveScannedCandidate(candidate); controllerRef.current?.markApproved() }
    const approvedIds = new Set(batch.map((candidate) => candidate.id))
    setCandidates((current) => current.filter((candidate) => !approvedIds.has(candidate.id)))
    if (approvedIds.size) await refresh()
  }
  const approveAll = () => approveCandidates(approvableCandidates)
  const approveAllDuplicates = () => approveCandidates(approvableDuplicates)
  const discardAll = () => {
    if (!candidates.length || !window.confirm(`Discard all ${candidates.length} scanned Echoes? This cannot be undone.`)) return
    candidates.forEach(() => controllerRef.current?.markRejected()); setCandidates([]); setReviewOpen(false); setActiveReviewId(undefined)
  }
  const rerunField = async (candidate: DiagnosticScanCandidate, regionId: string) => {
    try { const rescanned = await controllerRef.current?.rerunField(candidate, regionId); if (rescanned) updateCandidate({ ...rescanned, id: candidate.id, selected: candidate.selected }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Field retry failed.') }
  }

  useEffect(() => () => { if (streamRef.current) stopScreenSource(streamRef.current); videoSource.current.close(); void controllerRef.current?.cancel(); void feedbackAudioRef.current?.close() }, [])

  const activeReview = candidates.find((candidate) => candidate.id === activeReviewId) ?? candidates[0]
  const selectLayout = (layout: CalibrationProfile['layout']) => {
    const regions = regionsForLayout(layout)
    setSelectedLayout(layout)
    if (profile) setProfile({ ...profile, layout, panelRect: defaultPanelRectForLayout(layout), regions, updatedAt: Date.now() })
  }
  const toggleCalibration = () => {
    if (!profile || !calibrationImage) {
      setCalibrating(false)
      setError('Share the game window or upload a screenshot or build card before calibrating the scanner.')
      return
    }
    setError('')
    setCalibrating((value) => !value)
  }

  return <div className="scanner-view" onClickCapture={(event) => { if ((event.target as Element).closest('button')) setError('') }}>
    <PageHeader eyebrow="Echo scanner" title="Scan Echoes. Skip the typing." description="Choose what you see in-game, then start. Everything stays on this device."/>
    <Panel className="scanner-launchpad">
      <header className="scanner-launchpad-head"><span className="eyebrow">Start here</span><span className="scanner-private-pill">Private & local</span></header>
      <div className="scanner-step">
        <h2><b>1</b><span>Choose what you’re scanning</span></h2>
        <div className="scanner-source-picker" role="group" aria-label="Scan source layout">
          {([['echo-detail', 'Character menu', 'Equipped Echo details'], ['echo-management', 'Echo backpack', 'Inventory details'], ['build-card', 'Build card', 'Discord export image']] as const).map(([layout, label, hint]) => <button type="button" className={selectedLayout === layout ? 'active' : ''} aria-pressed={selectedLayout === layout} key={layout} onClick={() => selectLayout(layout)}><Icon name={layout === 'build-card' ? 'build' : 'echo'}/><span><strong>{label}</strong><small>{hint}</small></span><i>{selectedLayout === layout ? '✓' : ''}</i></button>)}
        </div>
      </div>
      <div className="scanner-step">
        <h2><b>2</b><span>Choose how to scan</span></h2>
        <div className="scanner-start-actions">
          {streaming ? <button className="danger scanner-live-action" onClick={stopScreen}><span className="scanner-action-icon"><Icon name="scan"/></span><span><strong>Stop live scan</strong><small>End window sharing</small></span></button> : <button className="primary scanner-live-action" onClick={() => void startScreen()}><span className="scanner-action-icon"><Icon name="scan"/></span><span><strong>Scan game window</strong><small>Best for multiple Echoes</small></span></button>}
          <button className="secondary" disabled={imageScanning} onClick={() => screenshotRef.current?.click()}><Icon name="upload"/><span><strong>{imageScanning ? 'Scanning…' : 'Use images'}</strong><small>Screenshots or build cards</small></span></button>
          <button className="secondary scanner-video-action" onClick={() => videoFileRef.current?.click()}><span><strong>Use a video</strong><small>Choose a local recording</small></span></button>
          <button className="secondary" onClick={() => void addManual()}><Icon name="plus"/><span><strong>Enter manually</strong><small>No image needed</small></span></button>
        </div>
      </div>
      <input ref={screenshotRef} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void acceptScreenshots(files) }}/>
      <input ref={videoFileRef} hidden type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void openVideo(file) }}/>
      {(imageScanning || status !== 'Idle') && !streaming && <div className="scanner-inline-status"><span className={`live-dot ${imageScanning ? 'on' : ''}`}/><strong>{status}</strong>{imageScanning && <><div className="progress"><i style={{ width: `${progress * 100}%` }}/></div><b>{Math.round(progress * 100)}%</b></>}</div>}
      {error && <div className="notice error scanner-capture-error">{error}</div>}
      {calibrationNotice && <div className="notice warning scanner-calibration-notice">{calibrationNotice}</div>}
      <div className="scanner-step scanner-final-step"><h2><b>3</b><span>Check and save</span></h2><small>Tip: paste an image directly with Ctrl+V</small></div>
      <details className="scanner-advanced">
        <summary><span><Icon name="settings"/>Advanced scanner settings</span><i aria-hidden="true"/></summary>
        <div className="scanner-controls"><label>Scan speed<select value={scanIntervalMs} onChange={(event) => void onScanIntervalChange(Number(event.target.value))}>{![500, 900, 1500].includes(scanIntervalMs) && <option value={scanIntervalMs}>Custom</option>}<option value="1500">Careful</option><option value="900">Balanced</option><option value="500">Fast</option></select></label><label>OCR workers<select value={workerPreference} onChange={(event) => { const value = event.target.value === 'auto' ? 'auto' : Number(event.target.value) as 1 | 2 | 4; setWorkerPreference(value); controllerRef.current?.setWorkerPreference(value) }}><option value="auto">Auto</option><option value="1">1</option><option value="2">2</option><option value="4">4</option></select></label><label className="check"><input type="checkbox" checked={debugVisible} onChange={(event) => setDebugVisible(event.target.checked)}/>Show scan boxes</label><label className="check"><input type="checkbox" checked={audioFeedback} onChange={(event) => void toggleAudioFeedback(event.target.checked)}/>Sound feedback</label><button className="secondary scanner-calibration-button" onClick={toggleCalibration}><Icon name="scan"/>{calibrating ? 'Close calibration' : 'Calibrate'}</button></div>
        <p className="scanner-setting-note">Scan speed changes how often the live window is checked. OCR workers split one scan’s text fields across CPU cores.</p>
        <ScanSessionSummary session={session}/>
      </details>
    </Panel>
    {calibrating && profile && calibrationImage && <ScannerCalibration
      key={profile.layout}
      imageDataUrl={calibrationImage}
      profile={profile}
      onChange={(next) => { setProfile(next); setSelectedLayout(next.layout) }}
      onSaved={(saved) => { setProfile(saved); setSelectedLayout(saved.layout); setError(''); setCalibrationNotice(''); setCalibrating(false); setStatus('Calibration profile saved locally') }}
    />}
    {streaming && <div className="scanner-layout scanner-layout-wide"><Panel className="capture-panel"><div className="capture-head"><div><span className="live-dot on"/><strong>Scanning live</strong></div><span>{status}</span></div><div className="video-stage active"><video ref={videoRef} muted playsInline autoPlay/>{profile && <div className="live-panel-overlay" style={{ left: `${profile.panelRect.x * 100}%`, top: `${profile.panelRect.y * 100}%`, width: `${profile.panelRect.width * 100}%`, height: `${profile.panelRect.height * 100}%` }}><ScannerDebugOverlay regions={profile.regions} visible={debugVisible}/></div>}</div><div className="capture-status"><div className="progress"><i style={{ width: `${progress * 100}%` }}/></div><span>{Math.round(progress * 100)}%</span><button className="text-button" onClick={() => void scanCurrentFrame()}>Scan now</button></div><div className="privacy-strip"><strong>Local only</strong><span>No frames leave this device.</span></div></Panel></div>}
    {videoDuration > 0 && <Panel className="video-scan-controls"><header><div><span className="eyebrow">Local video scan</span><h3>Trim and sample</h3></div><span>{videoEta}</span></header><div className="video-trim"><label>Start {videoTrim.start.toFixed(1)}s<input type="range" min="0" max={videoDuration} step=".1" value={videoTrim.start} onChange={(event) => setVideoTrim((value) => ({ ...value, start: Math.min(Number(event.target.value), value.end) }))}/></label><label>End {videoTrim.end.toFixed(1)}s<input type="range" min="0" max={videoDuration} step=".1" value={videoTrim.end} onChange={(event) => setVideoTrim((value) => ({ ...value, end: Math.max(Number(event.target.value), value.start) }))}/></label><label>Sampling<select value={videoTrim.fps} onChange={(event) => setVideoTrim((value) => ({ ...value, fps: Number(event.target.value) as VideoTrim['fps'] }))}>{[1, 2, 5, 10].map((fps) => <option value={fps} key={fps}>{fps} fps</option>)}</select></label>{videoScanning ? <button className="danger" onClick={cancelVideo}>Cancel immediately</button> : <button className="primary" onClick={() => void scanVideo()}>Scan video</button>}</div></Panel>}
    {candidates.length > 0 && <section className="scanned-echoes">
      <div className="section-heading scanned-echoes-heading"><div><span className="eyebrow">Ready to save</span><h2>Your scans <b>{candidates.length}</b></h2></div><div className="scanned-echo-actions"><button className="secondary" onClick={() => { setReviewOpen(true); setActiveReviewId(candidates[0]?.id) }}>Check scans</button><button className="primary" disabled={!approvableCandidates.length} onClick={() => void approveAll()}>Save all</button><button className="secondary" disabled={!approvableDuplicates.length} onClick={() => void approveAllDuplicates()}>Save duplicates</button><button className="danger" onClick={discardAll}>Discard all</button></div></div>
      <div className="scanned-echo-grid">{scannedBuildCards.map(({ candidate, details }) => <ScannedLoadoutCards key={details.id} details={details} onReview={() => { setActiveReviewId(candidate.id); setReviewOpen(true) }}/>)}{candidates.map((candidate) => { const duplicateBadge = candidate.duplicateOf ? <span className="scan-duplicate-badge">Duplicate</span> : null; if (candidateErrors(candidate).length > 0) return <button className={`scan-error-card${candidate.duplicateOf ? ' duplicate' : ''}`} key={candidate.id} onClick={() => { setActiveReviewId(candidate.id); setReviewOpen(true) }}>{duplicateBadge}<span>Needs a check</span><strong>{candidate.fields.name.value || 'Unknown Echo'}</strong><small>{candidateErrors(candidate).join(' ')}</small></button>; const echo = candidateToEcho(candidate); return <div className={`scanned-echo-card${candidate.duplicateOf ? ' duplicate' : ''}`} key={candidate.id}>{duplicateBadge}<EchoMiniCard echo={echo} rollRating={echoRollRating(echo)} equipment={<EquippedCharacterLabel name={candidate.fields.equippedBy.value}/>} onClick={() => { setActiveReviewId(candidate.id); setReviewOpen(true) }}/></div> })}</div>
    </section>}
    {reviewOpen && <div className="modal-backdrop scan-review-backdrop" role="dialog" aria-modal="true" aria-label="Review scans"><section className="panel scan-review-popout" ref={reviewRef}><header><div><span className="eyebrow">Check before saving</span><h2>Review your scans <b>{candidates.length}</b></h2></div><button className="close" aria-label="Close review" onClick={closeReview}>×</button></header>{candidates.length > 1 && <div className="review-candidate-tabs" ref={candidateTabsRef}>{candidates.map((candidate, index) => <button className={candidate.id === activeReview?.id ? 'active' : ''} onClick={() => setActiveReviewId(candidate.id)} key={candidate.id}>{index + 1}. {candidate.fields.name.value}</button>)}</div>}<div className="scan-review-scroll">{activeReview ? <ScanReviewCard candidate={activeReview} onChange={updateCandidate} onDiscard={() => { discard(activeReview); setActiveReviewId(undefined) }} onSave={() => { void save(activeReview); setActiveReviewId(undefined) }} onRerunField={(regionId) => void rerunField(activeReview, regionId)} onCopyDiagnostic={(includeImages) => void copyDiagnosticReport(activeReview, includeImages)}/> : <div className="empty-state compact"><h3>All done</h3><p>Close this window to scan more Echoes.</p></div>}</div></section></div>}
  </div>
}

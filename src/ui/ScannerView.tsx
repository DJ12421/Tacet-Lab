import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Echo } from '../domain/types'
import { createLocalId } from '../domain/id'
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

const manualText = `Unknown Echo\nCost 1\n5 Star\nLv. 0\nUnknown Sonata\nATK % 18.0%`
function feedbackTone(kind: 'new' | 'duplicate' | 'error') {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass(), oscillator = context.createOscillator(), gain = context.createGain()
  oscillator.frequency.value = kind === 'new' ? 720 : kind === 'duplicate' ? 420 : 220
  gain.gain.setValueAtTime(.045, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .13)
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .14)
  oscillator.addEventListener('ended', () => void context.close())
}

export function ScannerView({ echoes, refresh, scanIntervalMs, onSessionRiskChange }: { echoes: Echo[]; refresh: () => Promise<void>; scanIntervalMs: number; onSessionRiskChange?: (atRisk: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null), screenshotRef = useRef<HTMLInputElement>(null), videoFileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null), controllerRef = useRef<ScanSessionController | null>(null), detector = useRef(new StableFrameDetector())
  const imageScanningRef = useRef(false)
  const videoSource = useRef(new LocalVideoSource()), candidatesRef = useRef<DiagnosticScanCandidate[]>([]), echoesRef = useRef(echoes)
  const [streaming, setStreaming] = useState(false), [videoScanning, setVideoScanning] = useState(false), [imageScanning, setImageScanning] = useState(false)
  const [candidates, setCandidates] = useState<DiagnosticScanCandidate[]>([]), [session, setSession] = useState<ScanSession>()
  const [progress, setProgress] = useState(0), [status, setStatus] = useState('Idle'), [error, setError] = useState('')
  const [workerPreference, setWorkerPreference] = useState<OcrWorkerPreference>('auto'), [debugVisible, setDebugVisible] = useState(false)
  const [profile, setProfile] = useState<CalibrationProfile | undefined>(() => loadLatestCalibrationProfile()), [calibrationImage, setCalibrationImage] = useState(''), [calibrating, setCalibrating] = useState(false)
  const [selectedLayout, setSelectedLayout] = useState<CalibrationProfile['layout']>(() => loadLatestCalibrationProfile()?.layout ?? 'echo-detail')
  const [audioFeedback, setAudioFeedback] = useState(false)
  const [videoTrim, setVideoTrim] = useState<VideoTrim>({ start: 0, end: 0, fps: 2 }), [videoDuration, setVideoDuration] = useState(0)
  const [videoEta, setVideoEta] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false), [activeReviewId, setActiveReviewId] = useState<string>()

  useEffect(() => { candidatesRef.current = candidates }, [candidates])
  useEffect(() => { echoesRef.current = echoes }, [echoes])
  useLayoutEffect(() => { onSessionRiskChange?.(streaming || videoScanning || imageScanning || candidates.length > 0 || session?.status === 'running' || session?.status === 'stopping') })

  const acceptCandidate = (candidate: DiagnosticScanCandidate) => {
    setCandidates((current) => [...current, candidate].sort((left, right) => (left.frameSequence ?? Number.MAX_SAFE_INTEGER) - (right.frameSequence ?? Number.MAX_SAFE_INTEGER)))
    if (audioFeedback) feedbackTone(candidate.duplicateOf ? 'duplicate' : candidateErrors(candidate).length ? 'error' : 'new')
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
    if (prepared.needsCalibration) setError(`No compatible ${prepared.frame.width}x${prepared.frame.height} ${prepared.frame.layout} calibration was found. Review and save the detected panel.`)
    return prepared.profile
  }

  const stopScreen = () => {
    if (streamRef.current) stopScreenSource(streamRef.current)
    streamRef.current = null; if (videoRef.current) videoRef.current.srcObject = null
    detector.current.reset(); setStreaming(false); controllerRef.current?.requestCompletion(); setStatus('Share ended')
  }
  const startScreen = async () => {
    setError('')
    try {
      const controller = await createController('screen'), stream = await requestScreenSource(); streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      const dataUrl = videoRef.current ? captureScreenFrame(videoRef.current) : undefined
      if (dataUrl) await prepareCalibration(dataUrl, 'screen')
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

  useEffect(() => () => { if (streamRef.current) stopScreenSource(streamRef.current); videoSource.current.close(); void controllerRef.current?.cancel() }, [])

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
    <PageHeader eyebrow="Capture lab / English only" title="Decode Echo details and build cards" description="In-game panels and official Discord build cards are recognized locally. Screenshots, OCR evidence, and diagnostics stay on this device." actions={<div className="scanner-header-actions">{streaming ? <button className="danger" onClick={stopScreen}>Stop sharing</button> : <button className="primary" onClick={() => void startScreen()}><Icon name="scan"/>Share Game Window</button>}<button className="secondary" disabled={imageScanning} onClick={() => screenshotRef.current?.click()}><Icon name="upload"/>{imageScanning ? 'Scanning images…' : 'Images / build cards'}</button><button className="secondary" onClick={() => videoFileRef.current?.click()}>Video</button><button className="secondary" onClick={() => void addManual()}><Icon name="plus"/>Add Echo manually</button><input ref={screenshotRef} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void acceptScreenshots(files) }}/><input ref={videoFileRef} hidden type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void openVideo(file) }}/></div>}/>
    <div className="scanner-controls"><label>OCR workers<select value={workerPreference} onChange={(event) => { const value = event.target.value === 'auto' ? 'auto' : Number(event.target.value) as 1 | 2 | 4; setWorkerPreference(value); controllerRef.current?.setWorkerPreference(value) }}><option value="auto">Auto</option><option value="1">1</option><option value="2">2</option><option value="4">4</option></select></label><label className="check"><input type="checkbox" checked={debugVisible} onChange={(event) => setDebugVisible(event.target.checked)}/>Debug boxes</label><label className="check"><input type="checkbox" checked={audioFeedback} onChange={(event) => setAudioFeedback(event.target.checked)}/>Local audio feedback</label><button className="primary scanner-calibration-button" onClick={toggleCalibration}><Icon name="scan"/>{calibrating ? 'Close Calibration' : 'Calibrate Scanner'}</button><div className="scanner-layout-control"><span>Layout</span><details className="scanner-layout-picker"><summary>{selectedLayout === 'echo-detail' ? 'Character Menu' : selectedLayout === 'echo-management' ? 'Backpack' : 'Discord build card'}<i>⌄</i></summary><div>{([['echo-detail', 'Character Menu'], ['echo-management', 'Backpack'], ['build-card', 'Discord build card']] as const).map(([layout, label]) => <button type="button" className={selectedLayout === layout ? 'active' : ''} key={layout} onClick={(event) => { selectLayout(layout); event.currentTarget.closest('details')?.removeAttribute('open') }}>{label}</button>)}</div></details></div></div>
    {calibrating && profile && calibrationImage && <ScannerCalibration
      key={profile.layout}
      imageDataUrl={calibrationImage}
      profile={profile}
      onChange={(next) => { setProfile(next); setSelectedLayout(next.layout) }}
      onSaved={(saved) => { setProfile(saved); setSelectedLayout(saved.layout); setError(''); setCalibrating(false); setStatus('Calibration profile saved locally') }}
    />}
    <div className="scanner-layout scanner-layout-wide">
      <Panel className="capture-panel">{error && <div className="notice error scanner-capture-error">{error}</div>}<div className="capture-head"><div><span className={`live-dot ${streaming ? 'on' : ''}`}/><strong>{streaming ? 'Live window share' : imageScanning ? 'Scanning imported images' : 'Capture inactive'}</strong></div><span>{status}</span></div><div className={`video-stage ${streaming ? 'active' : ''}`}><video ref={videoRef} muted playsInline/>{streaming && profile && <div className="live-panel-overlay" style={{ left: `${profile.panelRect.x * 100}%`, top: `${profile.panelRect.y * 100}%`, width: `${profile.panelRect.width * 100}%`, height: `${profile.panelRect.height * 100}%` }}><ScannerDebugOverlay regions={profile.regions} visible={debugVisible}/></div>}{!streaming && <div className="stage-empty"><div className="scan-corners">⌗</div><h3>Share, paste, or import images</h3><p>Press Ctrl+V with a copied screenshot, or select multiple images with Images / build cards.</p></div>}</div><div className="capture-status"><div className="progress"><i style={{ width: `${progress * 100}%` }}/></div><span>{Math.round(progress * 100)}%</span><button className="text-button" disabled={!streaming} onClick={() => void scanCurrentFrame()}>Scan current frame</button></div><div className="privacy-strip"><strong>Privacy boundary</strong><span>Frames → browser memory → local English OCR → mandatory review. No scan data is uploaded.</span></div></Panel>
    </div>
    {videoDuration > 0 && <Panel className="video-scan-controls"><header><div><span className="eyebrow">Local video scan</span><h3>Trim and sample</h3></div><span>{videoEta}</span></header><div className="video-trim"><label>Start {videoTrim.start.toFixed(1)}s<input type="range" min="0" max={videoDuration} step=".1" value={videoTrim.start} onChange={(event) => setVideoTrim((value) => ({ ...value, start: Math.min(Number(event.target.value), value.end) }))}/></label><label>End {videoTrim.end.toFixed(1)}s<input type="range" min="0" max={videoDuration} step=".1" value={videoTrim.end} onChange={(event) => setVideoTrim((value) => ({ ...value, end: Math.max(Number(event.target.value), value.start) }))}/></label><label>Sampling<select value={videoTrim.fps} onChange={(event) => setVideoTrim((value) => ({ ...value, fps: Number(event.target.value) as VideoTrim['fps'] }))}>{[1, 2, 5, 10].map((fps) => <option value={fps} key={fps}>{fps} fps</option>)}</select></label>{videoScanning ? <button className="danger" onClick={cancelVideo}>Cancel immediately</button> : <button className="primary" onClick={() => void scanVideo()}>Scan video</button>}</div></Panel>}
    <ScanSessionSummary session={session}/>
    <section className="scanned-echoes">
      <div className="section-heading scanned-echoes-heading"><div><span className="eyebrow">Human checkpoint</span><h2>Scanned Echoes <b>{candidates.length}</b></h2></div><div className="scanned-echo-actions"><button className="secondary" disabled={!candidates.length} onClick={() => { setReviewOpen(true); setActiveReviewId(candidates[0]?.id) }}>Review queue</button><button className="primary" disabled={!approvableCandidates.length} onClick={() => void approveAll()}>Approve all</button><button className="secondary" disabled={!approvableDuplicates.length} onClick={() => void approveAllDuplicates()}>Approve all Duplicates</button><button className="danger" disabled={!candidates.length} onClick={discardAll}>Discard all</button></div></div>
      {candidates.length ? <div className="scanned-echo-grid">{candidates.map((candidate) => { const duplicateBadge = candidate.duplicateOf ? <span className="scan-duplicate-badge">Duplicate</span> : null; if (candidateErrors(candidate).length > 0) return <button className={`scan-error-card${candidate.duplicateOf ? ' duplicate' : ''}`} key={candidate.id} onClick={() => { setActiveReviewId(candidate.id); setReviewOpen(true) }}>{duplicateBadge}<span>Needs review</span><strong>{candidate.fields.name.value || 'Unknown Echo'}</strong><small>{candidateErrors(candidate).join(' ')}</small></button>; const echo = candidateToEcho(candidate); return <div className={`scanned-echo-card${candidate.duplicateOf ? ' duplicate' : ''}`} key={candidate.id}>{duplicateBadge}<EchoMiniCard echo={echo} rollRating={echoRollRating(echo)} equipment={<EquippedCharacterLabel name={candidate.fields.equippedBy.value}/>} onClick={() => { setActiveReviewId(candidate.id); setReviewOpen(true) }}/><button className="text-button" onClick={() => { setActiveReviewId(candidate.id); setReviewOpen(true) }}>Review details</button></div> })}</div> : <Panel className="empty-state compact"><h3>No scanned Echoes yet</h3><p>Successful scans will appear here as cards ready for review.</p></Panel>}
    </section>
    {reviewOpen && <div className="modal-backdrop scan-review-backdrop" role="dialog" aria-modal="true" aria-label="Human review"><Panel className="scan-review-popout"><header><div><span className="eyebrow">Human review</span><h2>Review scanned Echoes <b>{candidates.length}</b></h2></div><button className="close" aria-label="Close human review" onClick={() => setReviewOpen(false)}>×</button></header>{candidates.length > 1 && <div className="review-candidate-tabs">{candidates.map((candidate, index) => <button className={candidate.id === activeReview?.id ? 'active' : ''} onClick={() => setActiveReviewId(candidate.id)} key={candidate.id}>{index + 1}. {candidate.fields.name.value}</button>)}</div>}{activeReview ? <ScanReviewCard candidate={activeReview} onChange={updateCandidate} onDiscard={() => { discard(activeReview); setActiveReviewId(undefined) }} onSave={() => { void save(activeReview); setActiveReviewId(undefined) }} onRerunField={(regionId) => void rerunField(activeReview, regionId)} onCopyDiagnostic={(includeImages) => void copyDiagnosticReport(activeReview, includeImages)}/> : <div className="empty-state compact"><h3>No scans to review</h3><p>Close the review window and scan another Echo.</p></div>}</Panel></div>}
  </div>
}

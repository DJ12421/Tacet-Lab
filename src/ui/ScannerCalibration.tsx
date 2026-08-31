import { useRef, useState } from 'react'
import { calibrationExportProfiles, createCalibrationProfile, deleteCalibrationProfile, parseCalibrationProfiles, saveCalibrationProfile } from '../scanner/calibration'
import type { CalibrationProfile, ScanRect } from '../scanner/types'
import { defaultPanelRectForLayout, regionColor } from '../scanner/regions'

const clampPanelRect = (rect: ScanRect): ScanRect => ({
  x: Math.max(0, Math.min(.96, rect.x)), y: Math.max(0, Math.min(.96, rect.y)),
  width: Math.max(.08, Math.min(1 - rect.x, rect.width)), height: Math.max(.10, Math.min(1 - rect.y, rect.height))
})

const clampFieldRect = (rect: ScanRect, minimumSize = .02): ScanRect => {
  const x = Math.max(0, Math.min(.98, rect.x)), y = Math.max(0, Math.min(.98, rect.y))
  return { x, y, width: Math.max(minimumSize, Math.min(1 - x, rect.width)), height: Math.max(minimumSize, Math.min(1 - y, rect.height)) }
}
const minimumFieldSize = (regionId: string) => /^echo-\d+-cost$/.test(regionId) ? .004 : .02

export function ScannerCalibration({ imageDataUrl, profile, showScanBoxes, onChange, onShowScanBoxesChange, onSaved }: {
  imageDataUrl: string; profile: CalibrationProfile; showScanBoxes: boolean; onChange: (profile: CalibrationProfile) => void; onShowScanBoxesChange: (visible: boolean) => void; onSaved?: (profile: CalibrationProfile) => void
}) {
  const stageRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null), importRef = useRef<HTMLInputElement>(null)
  const [selectedRegionId, setSelectedRegionId] = useState(profile.regions[0]?.id ?? '')
  const [profileMessage, setProfileMessage] = useState('')
  const [showCalibrationText, setShowCalibrationText] = useState(true)
  const selectedRegion = profile.regions.find((region) => region.id === selectedRegionId) ?? profile.regions[0]

  const updateRegion = (regionId: string, rect: ScanRect) => onChange({
    ...profile, regions: profile.regions.map((region) => region.id === regionId ? { ...region, rect: clampFieldRect(rect, minimumFieldSize(region.id)) } : region), updatedAt: Date.now()
  })

  const beginPanelDrag = (event: React.PointerEvent, mode: 'move' | 'resize') => {
    const bounds = stageRef.current?.getBoundingClientRect(); if (!bounds) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX, startY = event.clientY, initial = { ...profile.panelRect }
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / bounds.width, dy = (next.clientY - startY) / bounds.height
      const panelRect = mode === 'move' ? clampPanelRect({ ...initial, x: initial.x + dx, y: initial.y + dy }) : clampPanelRect({ ...initial, width: initial.width + dx, height: initial.height + dy })
      onChange({ ...profile, panelRect, updatedAt: Date.now() })
    }
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true })
  }

  const beginFieldDrag = (event: React.PointerEvent, regionId: string, mode: 'move' | 'resize') => {
    const bounds = panelRef.current?.getBoundingClientRect(), region = profile.regions.find((entry) => entry.id === regionId)
    if (!bounds || !region) return
    event.preventDefault(); event.stopPropagation(); setSelectedRegionId(regionId); event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX, startY = event.clientY, initial = { ...region.rect }, initialRegions = profile.regions
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / bounds.width, dy = (next.clientY - startY) / bounds.height
      const minimumSize = minimumFieldSize(region.id)
      const rect = mode === 'move' ? clampFieldRect({ ...initial, x: initial.x + dx, y: initial.y + dy }, minimumSize) : clampFieldRect({ ...initial, width: initial.width + dx, height: initial.height + dy }, minimumSize)
      onChange({ ...profile, regions: initialRegions.map((entry) => entry.id === regionId ? { ...entry, rect } : entry), updatedAt: Date.now() })
    }
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true })
  }

  const setCoordinate = (key: keyof ScanRect, value: number) => {
    if (!selectedRegion || !Number.isFinite(value)) return
    updateRegion(selectedRegion.id, { ...selectedRegion.rect, [key]: value })
  }

  const exportProfile = () => {
    const bundle = { version: 2, exportedAt: Date.now(), profiles: calibrationExportProfiles(profile) }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = `tacet-lab-calibrations-${profile.sourceWidth}x${profile.sourceHeight}.json`; link.click()
    URL.revokeObjectURL(url); setProfileMessage('Character Menu, Backpack, and all six build-card profiles exported')
  }

  const importProfile = async (file?: File) => {
    if (!file) return
    try {
      const imported = parseCalibrationProfiles(await file.text()).map(saveCalibrationProfile)
      const active = imported.find((entry) => entry.layout === profile.layout
        && (entry.layout !== 'build-card' || entry.buildCardFormat === profile.buildCardFormat)) ?? imported[0]
      setSelectedRegionId(active.regions[0]?.id ?? ''); onChange(active); setProfileMessage(`${imported.length} calibration profile${imported.length === 1 ? '' : 's'} imported and saved`)
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Calibration import failed.')
    }
  }

  const deleteProfile = () => {
    deleteCalibrationProfile(profile)
    const reset = createCalibrationProfile(profile.sourceWidth, profile.sourceHeight, defaultPanelRectForLayout(profile.layout), profile.layout, profile.uiScale, profile.buildCardFormat)
    setSelectedRegionId(reset.regions[0]?.id ?? ''); onChange(reset); setProfileMessage('Saved profile deleted; defaults restored')
  }

  return <div className="scanner-calibration">
  <div className="calibration-toolbar"><div><strong>Calibration</strong><span>{profile.name}</span>{profileMessage && <small>{profileMessage}</small>}</div><label className="check"><input type="checkbox" checked={showScanBoxes} onChange={(event) => onShowScanBoxesChange(event.target.checked)}/>SHOW CALIBRATION BOXES</label><label className="check"><input type="checkbox" checked={showCalibrationText} disabled={!showScanBoxes} onChange={(event) => setShowCalibrationText(event.target.checked)}/>SHOW CALIBRATION BOX NAMES</label><button type="button" className="secondary" onClick={() => { const saved = saveCalibrationProfile(profile); onChange(saved); onSaved?.(saved) }}>Save profile</button><button type="button" className="text-button" onClick={exportProfile}>Export</button><button type="button" className="text-button" onClick={() => importRef.current?.click()}>Import</button><button type="button" className="text-button danger" onClick={deleteProfile}>Delete</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importProfile(file) }}/></div>
    <div className="calibration-workspace">
      <div className="calibration-stage" ref={stageRef}>
        <img src={imageDataUrl} alt="Calibration source"/>
        {showScanBoxes && <div ref={panelRef} className="calibration-panel-box" style={{ left: `${profile.panelRect.x * 100}%`, top: `${profile.panelRect.y * 100}%`, width: `${profile.panelRect.width * 100}%`, height: `${profile.panelRect.height * 100}%` }} onPointerDown={(event) => beginPanelDrag(event, 'move')}>
          {showCalibrationText && <span>Panel</span>}
          <div className="calibration-region-preview">{profile.regions.map((region) => <div
            role="button" tabIndex={0} aria-label={`Calibrate ${region.label}`} title={`${region.label}: drag to move; use the corner to resize`}
            className={`calibration-field-box ${selectedRegion?.id === region.id ? 'selected' : ''}`} key={region.id}
            style={{ left: `${region.rect.x * 100}%`, top: `${region.rect.y * 100}%`, width: `${region.rect.width * 100}%`, height: `${region.rect.height * 100}%`, borderColor: regionColor(region), color: regionColor(region) }}
            onPointerDown={(event) => beginFieldDrag(event, region.id, 'move')} onFocus={() => setSelectedRegionId(region.id)}
          >{showCalibrationText && <span>{region.label}</span>}<button type="button" aria-label={`Resize ${region.label}`} onPointerDown={(event) => beginFieldDrag(event, region.id, 'resize')}/></div>)}</div>
          <button type="button" className="panel-resize-handle" aria-label="Resize panel" onPointerDown={(event) => { event.stopPropagation(); beginPanelDrag(event, 'resize') }}/>
        </div>}
      </div>
      <aside className="calibration-field-inspector">
        <span className="eyebrow">Selected field</span><h3>{selectedRegion?.label ?? 'None'}</h3><p>Drag the field box to move it. Drag its lower-right square to resize it.</p>
        {selectedRegion && <div>{(['x', 'y', 'width', 'height'] as Array<keyof ScanRect>).map((key) => <label key={key}>{key}<input type="number" min="0" max="1" step=".001" value={Number(selectedRegion.rect[key].toFixed(4))} onChange={(event) => setCoordinate(key, Number(event.target.value))}/></label>)}</div>}
        <small>Coordinates are normalized from 0 to 1 and relative to the calibrated panel.</small>
      </aside>
    </div>
  </div>
}

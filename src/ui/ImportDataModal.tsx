import { useEffect, useRef, useState } from 'react'
import type { AccountDocument } from '../domain/types'
import { exportAccount, importAccount, prepareAccountBackup, previewAccountImport, type AccountImportPreview } from '../storage/database'
import { prepareNativeBuildChoices } from '../storage/import-build-choices'
import { convertExternalAccountExport, isExternalAccountExport, type ExternalCharacterChoice } from '../storage/import-external-account'
import { convertRotationExport, isRotationExport } from '../storage/import-rotation-export'
import { convertWavescanExport, isWavescanExport } from '../storage/import-wavescan'
import { Icon, Panel } from './primitives'
import { confirmDiscardChanges, useUnsavedChanges } from './useUnsavedChanges'

const emptyFileLabel = 'No file selected'

interface ImportDataModalProps {
  onClose: () => void
  onImported: (preview: AccountImportPreview) => Promise<void> | void
}

function formattedExportDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ImportDataModal({ onClose, onImported }: ImportDataModalProps) {
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState(emptyFileLabel)
  const [account, setAccount] = useState<AccountDocument>()
  const [preview, setPreview] = useState<AccountImportPreview>()
  const [repairs, setRepairs] = useState<string[]>([])
  const [sourceNotices, setSourceNotices] = useState<string[]>([])
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceCharacters, setSourceCharacters] = useState<ExternalCharacterChoice[]>([])
  const [externalAccountSource, setExternalAccountSource] = useState<Record<string, unknown>>()
  const [nativeSource, setNativeSource] = useState<unknown>()
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const analysisRef = useRef(0)
  const dirty = Boolean(raw.trim() || fileName !== emptyFileLabel)
  useUnsavedChanges(dirty)
  const requestClose = () => { if (confirmDiscardChanges(dirty)) onClose() }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !importing) requestClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [importing, requestClose])

  const prepare = async (parsed: unknown, analysisId: number, choices: Record<string, boolean> = {}) => {
    const rotationExport = isRotationExport(parsed)
    const converted = rotationExport ? convertRotationExport(parsed, await exportAccount())
      : isWavescanExport(parsed) ? await convertWavescanExport(parsed)
        : isExternalAccountExport(parsed) ? await convertExternalAccountExport(parsed, choices) : undefined
    const prepared = prepareAccountBackup(converted?.document ?? parsed)
    const native = converted ? undefined : await prepareNativeBuildChoices(prepared.document, choices)
    const document = native?.document ?? prepared.document
    const nextPreview = await previewAccountImport(document)
    if (analysisId !== analysisRef.current) return
    setAccount(document)
    setPreview(nextPreview)
    setRepairs(prepared.repairs)
    setSourceNotices(converted?.notices ?? [])
    setSourceLabel(rotationExport ? 'Rotation export' : isWavescanExport(parsed) ? 'WaveScan export' : converted ? 'WutheringTools account' : '')
    setSourceCharacters(converted && 'choices' in converted ? converted.choices : native?.choices ?? [])
    setExternalAccountSource(isExternalAccountExport(parsed) ? parsed : undefined)
    setNativeSource(converted ? undefined : parsed)
  }

  const analyze = async (nextRaw: string, nextFileName = 'Pasted JSON data', pasted = false) => {
    const analysisId = ++analysisRef.current
    setRaw(pasted ? nextRaw : '')
    setFileName(nextFileName)
    setAccount(undefined)
    setPreview(undefined)
    setRepairs([])
    setSourceNotices([])
    setSourceLabel('')
    setSourceCharacters([])
    setExternalAccountSource(undefined)
    setNativeSource(undefined)
    setError('')
    if (!nextRaw.trim()) {
      setAnalyzing(false)
      if (!pasted) setError('This file is empty. Choose an export with JSON data.')
      return
    }
    try {
      const parsed: unknown = JSON.parse(nextRaw)
      setAnalyzing(true)
      await prepare(parsed, analysisId)
    } catch (caught) {
      if (analysisId !== analysisRef.current) return
      setError(caught instanceof SyntaxError ? `The JSON is incomplete or malformed. ${caught.message}` : caught instanceof Error ? caught.message : 'Could not analyze this import.')
    } finally {
      if (analysisId === analysisRef.current) setAnalyzing(false)
    }
  }

  const setBuildChoice = async (catalogId: string, enabled: boolean) => {
    if (!externalAccountSource && !nativeSource) return
    const analysisId = ++analysisRef.current
    const choices = Object.fromEntries(sourceCharacters.map((choice) => [choice.catalogId, choice.catalogId === catalogId ? enabled : choice.addAsNewBuild]))
    setAnalyzing(true)
    setAccount(undefined)
    setPreview(undefined)
    setError('')
    try { await prepare(externalAccountSource ?? nativeSource, analysisId, choices) }
    catch (caught) { if (analysisId === analysisRef.current) setError(caught instanceof Error ? caught.message : 'Could not update the import preview.') }
    finally { if (analysisId === analysisRef.current) setAnalyzing(false) }
  }

  const chooseFile = async (file?: File) => {
    if (!file) return
    try {
      await analyze(await file.text(), file.name)
    } catch (caught) {
      setError(caught instanceof Error ? `Could not read ${file.name}: ${caught.message}` : 'Could not read this file.')
    }
  }

  const merge = async () => {
    if (!account || !preview || importing) return
    setImporting(true)
    setError('')
    try {
      const result = await importAccount(account)
      await onImported(result)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed.')
      setImporting(false)
    }
  }

  const hasChanges = Boolean(preview && (preview.added > 0 || preview.updated > 0))

  return <div className="modal-backdrop import-data-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) requestClose() }}>
    <Panel className="import-data-modal" role="dialog" aria-modal="true" aria-labelledby="import-data-title">
      <header className="import-data-header">
        <div><span className="eyebrow">Your data</span><h2 id="import-data-title">Import data</h2><p>Choose a file, review the changes, then import.</p></div>
        <button className="close" aria-label="Close import" disabled={importing} onClick={requestClose}>×</button>
      </header>

      <div className="import-data-scroll">
      <section className="import-data-source">
        <div className="import-supported" aria-label="Supported imports">
          <div><strong>Tacet Lab backup</strong><small>Account data</small></div>
          <div><strong>WaveScan</strong><small>Echoes</small></div>
          <div><strong>WutheringTools account</strong><small>v9 · Characters, gear, teams</small></div>
          <div><strong>WuWa Lab rotation</strong><small>Team and rotation</small></div>
        </div>
        <div className="import-file-row">
          <button className="secondary" type="button" autoFocus disabled={importing} onClick={() => fileRef.current?.click()}><Icon name="upload"/>Choose file</button>
          <div><Icon name="build"/><span>{fileName}</span></div>
          <input ref={fileRef} hidden type="file" accept="application/json,.json,.txt" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }}/>
        </div>
        <p className="import-safety"><Icon name="lock"/>Preview first. No records are deleted.</p>
        <details className="import-paste"><summary>Or paste JSON</summary><label className="import-json-input"><span>Export JSON</span><textarea spellCheck={false} value={raw} disabled={importing} placeholder="Paste export JSON here…" onChange={(event) => void analyze(event.target.value, 'Pasted JSON data', true)}/></label></details>
        {error && <div className="import-message error" role="alert"><strong>Could not prepare import</strong><span>{error}</span></div>}
        {analyzing && <div className="import-message"><span className="import-spinner"/><span>Comparing the import with your local database…</span></div>}
      </section>

      {preview && <section className="import-preview">
        <header>
          <div><span className="eyebrow">Review changes</span><h3>{sourceLabel || 'Tacet Lab backup'}</h3></div>
          <div><small>Exported {formattedExportDate(preview.exportedAt)}</small></div>
        </header>
        {sourceNotices.length > 0 && <div className="import-repair-notice import-source-notices" role="status"><strong>Import notes</strong><p>{sourceNotices[0]}</p>{sourceNotices.length > 1 && <details><summary>{sourceNotices.length - 1} more notes</summary><ul>{sourceNotices.slice(1).map((notice) => <li key={notice}>{notice}</li>)}</ul></details>}</div>}
        {sourceCharacters.some((choice) => choice.existing) && <section className="import-build-choices" aria-label="Build import choices"><header><h3>Existing characters</h3><p>Save a new build to keep Equipped, or turn it off to replace Equipped.</p></header><div>{sourceCharacters.filter((choice) => choice.existing).map((choice) => <label key={choice.catalogId}><strong title={choice.name}>{choice.name}</strong><span>{choice.addAsNewBuild ? 'New build' : 'Replace Equipped'}</span><input type="checkbox" aria-label={`Save ${choice.name} as a new build`} checked={choice.addAsNewBuild} disabled={importing || analyzing} onChange={(event) => void setBuildChoice(choice.catalogId, event.target.checked)}/></label>)}</div></section>}
        {repairs.length > 0 && <div className="import-repair-notice" role="status"><strong>Timing recovered from this backup</strong><p>{repairs.length} rotation action{repairs.length === 1 ? '' : 's'} had missing timing. Tacet Lab estimated the values below. Review these actions after import.</p><ul>{repairs.map((repair) => <li key={repair}>{repair}</li>)}</ul></div>}
        <div className="import-summary-strip">
          <div><span>New</span><strong>{preview.added}</strong></div>
          <div><span>Updates</span><strong>{preview.updated}</strong></div>
          <div><span>Duplicates</span><strong>{preview.duplicates}</strong></div>
        </div>
        <div className="import-collection-grid">
          {preview.collections.filter((collection) => collection.incoming).map((collection) => <article key={collection.key}>
            <header><strong>{collection.label}</strong><b>{collection.incoming} incoming</b></header>
            <dl>
              <div><dt>New</dt><dd className="new">+{collection.added}</dd></div>
              <div><dt>Updates</dt><dd className="updated">{collection.updated}</dd></div>
              <div><dt>Already here</dt><dd>{collection.duplicates}</dd></div>
            </dl>
          </article>)}
        </div>
      </section>}
      </div>

      <footer className="import-data-actions">
        <div>{preview && !hasChanges ? <span>Everything is already here.</span> : sourceCharacters.some((choice) => choice.existing && !choice.addAsNewBuild) ? <span>Some equipped builds will be replaced.</span> : repairs.length ? <span>Review the recovered timing.</span> : preview ? <span>New records are added; matching records are updated.</span> : null}</div>
        <button className="secondary" type="button" disabled={importing} onClick={requestClose}>Cancel</button>
        <button className="primary" type="button" disabled={!hasChanges || importing || analyzing} onClick={() => void merge()}><Icon name="upload"/>{importing ? 'Merging…' : `Apply ${(preview?.added ?? 0) + (preview?.updated ?? 0)} changes`}</button>
      </footer>
    </Panel>
  </div>
}

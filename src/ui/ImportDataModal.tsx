import { useEffect, useRef, useState } from 'react'
import type { AccountDocument } from '../domain/types'
import { exportAccount, importAccount, prepareAccountBackup, previewAccountImport, type AccountImportOptions, type AccountImportPreview } from '../storage/database'
import { prepareNativeBuildChoices } from '../storage/import-build-choices'
import { convertExternalAccountExport, isExternalAccountExport, type ExternalCharacterChoice } from '../storage/import-external-account'
import { convertRotationExport, isRotationExport } from '../storage/import-rotation-export'
import { convertWavescanExport, isWavescanExport } from '../storage/import-wavescan'
import { Icon, Panel } from './primitives'
import { confirmDiscardChanges, useUnsavedChanges } from './useUnsavedChanges'

const emptyFileLabel = 'No file selected'
const defaultImportOptions: AccountImportOptions = { updateExisting: true, deleteMissingGear: false, deleteMissingCharacters: false, overwrite: false }

interface ImportDataModalProps {
  onClose: () => void
  onImported: (preview: AccountImportPreview, options: AccountImportOptions) => Promise<void> | void
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
  const [importSource, setImportSource] = useState<unknown>()
  const [options, setOptions] = useState(defaultImportOptions)
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

  const prepare = async (parsed: unknown, analysisId: number, choices: Record<string, boolean> = {}, nextOptions = options) => {
    const authoritative = nextOptions.overwrite || nextOptions.deleteMissingGear || nextOptions.deleteMissingCharacters
    const rotationExport = isRotationExport(parsed)
    const wavescanExport = isWavescanExport(parsed)
    const externalExport = !rotationExport && !wavescanExport && isExternalAccountExport(parsed)
    const external = externalExport ? await convertExternalAccountExport(parsed, choices, authoritative) : undefined
    const current = rotationExport ? await exportAccount() : undefined
    const rotationBase = current && authoritative ? { ...current, echoes: [], characters: [], weapons: [], builds: [], equippedLoadouts: [], theorycraftBuilds: [], teams: [] } : current
    const converted = rotationExport ? convertRotationExport(parsed, rotationBase!)
      : wavescanExport ? await convertWavescanExport(parsed, authoritative)
        : external
    const prepared = prepareAccountBackup(converted?.document ?? parsed)
    const native = converted || authoritative ? undefined : await prepareNativeBuildChoices(prepared.document, choices)
    const document = native?.document ?? prepared.document
    const nextPreview = await previewAccountImport(document, nextOptions)
    if (analysisId !== analysisRef.current) return
    setAccount(document)
    setPreview(nextPreview)
    setRepairs(prepared.repairs)
    setSourceNotices(converted?.notices ?? [])
    setSourceLabel(rotationExport ? 'Rotation export' : wavescanExport ? 'WaveScan export' : converted ? 'WutheringTools account' : '')
    setSourceCharacters(external?.choices ?? native?.choices ?? [])
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
    setImportSource(undefined)
    setOptions(defaultImportOptions)
    setError('')
    if (!nextRaw.trim()) {
      setAnalyzing(false)
      if (!pasted) setError('This file is empty. Choose an export with JSON data.')
      return
    }
    try {
      const parsed: unknown = JSON.parse(nextRaw)
      setImportSource(parsed)
      setAnalyzing(true)
      await prepare(parsed, analysisId, {}, defaultImportOptions)
    } catch (caught) {
      if (analysisId !== analysisRef.current) return
      setError(caught instanceof SyntaxError ? `The JSON is incomplete or malformed. ${caught.message}` : caught instanceof Error ? caught.message : 'Could not analyze this import.')
    } finally {
      if (analysisId === analysisRef.current) setAnalyzing(false)
    }
  }

  const updatePreview = async (choices: Record<string, boolean>, nextOptions = options) => {
    if (!importSource) return
    const analysisId = ++analysisRef.current
    setAnalyzing(true)
    setAccount(undefined)
    setPreview(undefined)
    setError('')
    try { await prepare(importSource, analysisId, choices, nextOptions) }
    catch (caught) { if (analysisId === analysisRef.current) setError(caught instanceof Error ? caught.message : 'Could not update the import preview.') }
    finally { if (analysisId === analysisRef.current) setAnalyzing(false) }
  }

  const currentBuildChoices = () => Object.fromEntries(sourceCharacters.map((choice) => [choice.catalogId, choice.addAsNewBuild]))
  const setBuildChoice = (catalogId: string, enabled: boolean) => updatePreview(Object.fromEntries(sourceCharacters.map((choice) => [choice.catalogId, choice.catalogId === catalogId ? enabled : choice.addAsNewBuild])))
  const setImportOption = (key: keyof AccountImportOptions, enabled: boolean) => {
    const next: AccountImportOptions = key === 'overwrite' && enabled ? { ...defaultImportOptions, overwrite: true } : { ...options, [key]: enabled }
    setOptions(next)
    return updatePreview(currentBuildChoices(), next)
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
      const result = await importAccount(account, options)
      await onImported(result, options)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed.')
      setImporting(false)
    }
  }

  const importCount = preview?.collections.reduce((sum, collection) => sum + collection.incoming, 0) ?? 0
  const currentCount = preview?.collections.reduce((sum, collection) => sum + collection.current, 0) ?? 0
  const deleting = options.overwrite || options.deleteMissingGear || options.deleteMissingCharacters
  const hasChanges = Boolean(preview && (options.overwrite || preview.added > 0 || preview.updated > 0 || preview.removed > 0))
  const existingCharacters = sourceCharacters.filter((choice) => choice.existing)

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
          <div><strong>WutheringTools account</strong><small>Characters, gear, teams</small></div>
          <div><strong>WuWa Lab rotation</strong><small>Team and rotation</small></div>
        </div>
        <div className="import-file-row">
          <button className="secondary" type="button" autoFocus disabled={importing} onClick={() => fileRef.current?.click()}><Icon name="upload"/>Choose file</button>
          <div><Icon name="build"/><span>{fileName}</span></div>
          <input ref={fileRef} hidden type="file" accept="application/json,.json,.txt" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }}/>
        </div>
        <p className="import-safety"><Icon name="lock"/>{options.overwrite ? 'Complete overwrite permanently replaces all current data.' : deleting ? 'Selected cleanup options permanently delete records missing from this import.' : 'Preview first. No records are deleted.'}</p>
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
        <section className="import-mode-choices" aria-label="Import behavior"><label><input type="checkbox" checked={options.updateExisting} disabled={importing || analyzing || options.overwrite} onChange={(event) => void setImportOption('updateExisting', event.target.checked)}/><span>Update matches / skip dupes</span></label><label><input type="checkbox" checked={options.deleteMissingGear} disabled={importing || analyzing || options.overwrite} onChange={(event) => void setImportOption('deleteMissingGear', event.target.checked)}/><span>Delete Echoes / weapons not in import</span></label><label><input type="checkbox" checked={options.deleteMissingCharacters} disabled={importing || analyzing || options.overwrite} onChange={(event) => void setImportOption('deleteMissingCharacters', event.target.checked)}/><span>Delete characters not in import</span></label><label className="danger"><input type="checkbox" checked={options.overwrite} disabled={importing || analyzing} onChange={(event) => void setImportOption('overwrite', event.target.checked)}/><span>Complete overwrite</span></label></section>
        {existingCharacters.length > 0 && <section className="import-build-choices" aria-label="Build import choices"><header><h3>Existing characters</h3><p>Save a new build to keep Equipped, or turn it off to replace Equipped.</p></header><div>{existingCharacters.map((choice) => <label key={choice.catalogId}><strong title={choice.name}>{choice.name}</strong><span>{choice.addAsNewBuild ? 'New build' : 'Replace Equipped'}</span><input type="checkbox" aria-label={`Save ${choice.name} as a new build`} checked={choice.addAsNewBuild} disabled={importing || analyzing} onChange={(event) => void setBuildChoice(choice.catalogId, event.target.checked)}/></label>)}</div></section>}
        {repairs.length > 0 && <div className="import-repair-notice" role="status"><strong>Timing recovered from this backup</strong><p>{repairs.length} rotation action{repairs.length === 1 ? '' : 's'} had missing timing. Tacet Lab estimated the values below. Review these actions after import.</p><ul>{repairs.map((repair) => <li key={repair}>{repair}</li>)}</ul></div>}
        <div className="import-summary-strip">
          {options.overwrite ? <><div><span>Current</span><strong>{currentCount}</strong></div><div><span>Incoming</span><strong>{importCount}</strong></div><div><span>Result</span><strong>{importCount}</strong></div></> : deleting ? <><div><span>New</span><strong>{preview.added}</strong></div><div><span>Updates</span><strong>{preview.updated}</strong></div><div><span>Removed</span><strong>{preview.removed}</strong></div></> : <><div><span>New</span><strong>{preview.added}</strong></div><div><span>Updates</span><strong>{preview.updated}</strong></div><div><span>Duplicates</span><strong>{preview.duplicates}</strong></div></>}
        </div>
        <div className="import-collection-grid">
          {preview.collections.filter((collection) => collection.incoming || collection.removed).map((collection) => <article key={collection.key}>
            <header><strong>{collection.label}</strong><b>{collection.incoming} incoming</b></header>
            <dl>
              {options.overwrite ? <><div><dt>Current</dt><dd>{collection.current}</dd></div><div><dt>Incoming</dt><dd className="new">{collection.incoming}</dd></div><div><dt>Result</dt><dd>{collection.result}</dd></div></> : deleting ? <><div><dt>New</dt><dd className="new">+{collection.added}</dd></div><div><dt>Updates</dt><dd className="updated">{collection.updated}</dd></div><div><dt>Removed</dt><dd>{collection.removed}</dd></div></> : <><div><dt>New</dt><dd className="new">+{collection.added}</dd></div><div><dt>Updates</dt><dd className="updated">{collection.updated}</dd></div><div><dt>Already here</dt><dd>{collection.duplicates}</dd></div></>}
            </dl>
          </article>)}
        </div>
      </section>}
      </div>

      <footer className="import-data-actions">
        <div>{preview && !hasChanges ? <span>Everything is already here.</span> : options.overwrite ? <span>All current data will be permanently replaced.</span> : preview?.removed ? <span>{preview.removed} record{preview.removed === 1 ? '' : 's'} will be permanently deleted.</span> : sourceCharacters.some((choice) => choice.existing && !choice.addAsNewBuild) ? <span>Some equipped builds will be replaced.</span> : repairs.length ? <span>Review the recovered timing.</span> : preview ? <span>New records are added; matching records are updated.</span> : null}</div>
        <button className="secondary" type="button" disabled={importing} onClick={requestClose}>Cancel</button>
        <button className={deleting ? 'primary danger' : 'primary'} type="button" disabled={!hasChanges || importing || analyzing} onClick={() => void merge()}><Icon name="upload"/>{importing ? (options.overwrite ? 'Replacing…' : 'Importing…') : options.overwrite ? `Replace with ${importCount} records` : `Apply ${(preview?.added ?? 0) + (preview?.updated ?? 0) + (preview?.removed ?? 0)} changes`}</button>
      </footer>
    </Panel>
  </div>
}

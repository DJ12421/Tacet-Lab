import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ScanSessionController } from '../scanner/session'
import { ScannerView } from './ScannerView'

vi.mock('../scanner/sources/screenshot-source', () => ({
  readScreenshot: vi.fn(async (file: File) => `data:image/png;base64,${file.name}`)
}))
vi.mock('../scanner/ocr-pool', () => ({ OcrPool: class {
  warm() { return Promise.resolve() }
  metrics() { return { queueDepth: 0 } }
  terminate() { return Promise.resolve() }
  cancel() { return Promise.resolve() }
} }))
vi.mock('../scanner/frame', () => ({
  captureSourceDataUrl: vi.fn(),
  prepareScanFrame: vi.fn(async () => ({ profile: {
    id: 'test', name: 'test', sourceWidth: 1920, sourceHeight: 1080, uiScale: 1,
    layout: 'echo-detail', panelRect: { x: .6, y: .1, width: .39, height: .88 }, regions: []
  } }))
}))

afterEach(() => vi.restoreAllMocks())

it('keeps a screenshot batch moving with at most four scans in flight', async () => {
  const resolveScans: Array<(accepted: boolean) => void> = []
  const enqueue = vi.spyOn(ScanSessionController.prototype, 'enqueue').mockImplementation(() =>
    new Promise<boolean>((resolve) => { resolveScans.push(resolve) }))
  const { container } = render(<ScannerView echoes={[]} refresh={async () => {}}/>)
  const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!
  const files = Array.from({ length: 5 }, (_, index) => new File(['image'], `echo-${index}.png`, { type: 'image/png' }))

  fireEvent.change(input, { target: { files } })
  await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(4))
  await act(async () => { resolveScans[0](true) })
  await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(5))
  await act(async () => { resolveScans.slice(1).forEach((resolve) => resolve(true)) })
  expect(await screen.findByText('Image scan complete (5/5)')).toBeInTheDocument()
})

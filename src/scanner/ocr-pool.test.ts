import { expect, it, vi } from 'vitest'
import { OcrPool } from './ocr-pool'

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(async () => ({ terminate: vi.fn(async () => {}) })),
  terminateScheduler: vi.fn(async () => {})
}))
vi.mock('tesseract.js', () => ({
  createWorker: mocks.createWorker,
  createScheduler: () => ({ addWorker: () => {}, terminate: mocks.terminateScheduler }),
  PSM: {}
}))

it('releases excess idle workers and does not warm a completed pool on preference changes', async () => {
  mocks.createWorker.mockClear()
  mocks.terminateScheduler.mockClear()
  const pool = new OcrPool({ preference: 2 })
  await pool.warm()
  expect(mocks.createWorker).toHaveBeenCalledTimes(2)

  pool.setPreference(1)
  expect(mocks.terminateScheduler).toHaveBeenCalledOnce()
  expect(pool.metrics().workerCount).toBe(1)

  await pool.terminate()
  pool.setPreference(4)
  expect(mocks.terminateScheduler).toHaveBeenCalledTimes(2)
  expect(mocks.createWorker).toHaveBeenCalledTimes(2)
})

it('does not let cancelled warm-up clear a newer retry', async () => {
  const makeWorker = () => ({ terminate: vi.fn(async () => {}) })
  let resolveOld!: (worker: ReturnType<typeof makeWorker>) => void
  let resolveNew!: (worker: ReturnType<typeof makeWorker>) => void
  mocks.createWorker.mockReset()
  mocks.createWorker.mockImplementation(async () => makeWorker())
  mocks.createWorker.mockImplementationOnce(() => new Promise<ReturnType<typeof makeWorker>>((resolve) => { resolveOld = resolve }))
  mocks.createWorker.mockImplementationOnce(() => new Promise<ReturnType<typeof makeWorker>>((resolve) => { resolveNew = resolve }))
  const pool = new OcrPool({ preference: 1 })

  const oldWarm = pool.warm()
  await pool.cancel()
  const newWarm = pool.warm()
  resolveOld(makeWorker())
  await oldWarm
  const sameWarm = pool.warm()
  expect(mocks.createWorker).toHaveBeenCalledTimes(2)
  resolveNew(makeWorker())
  await Promise.all([newWarm, sameWarm])
  await pool.terminate()
})

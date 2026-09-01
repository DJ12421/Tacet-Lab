/// <reference lib="webworker" />
import { createOptimizerWorkPlan, optimizeOptimizerWorkUnit, type OptimizerWorkPlan } from '../domain/optimizer'
import type { OptimizerRequest } from '../domain/types'

type InitCommand = { type: 'init'; request: OptimizerRequest }
type RunCommand = { type: 'run'; requestId: string; workIndex: number; scoreThreshold?: number; maxEvaluations?: number }
type ThresholdCommand = { type: 'threshold'; requestId: string; scoreThreshold?: number }
type OptimizerWorkerCommand = InitCommand | RunCommand | ThresholdCommand

let plan: OptimizerWorkPlan | undefined
let globalScoreThreshold: number | undefined

self.onmessage = (event: MessageEvent<OptimizerWorkerCommand>) => {
  const command = event.data
  try {
    if (command.type === 'init') {
      plan = createOptimizerWorkPlan(command.request)
      globalScoreThreshold = command.request.scoreThreshold
      self.postMessage({ type: 'ready', requestId: command.request.requestId, total: plan.total, workCount: plan.work.length })
      return
    }
    if (!plan || plan.request.requestId !== command.requestId) return
    if (command.type === 'threshold') {
      globalScoreThreshold = command.scoreThreshold
      return
    }
    const scoreThreshold = Math.max(globalScoreThreshold ?? Number.NEGATIVE_INFINITY, command.scoreThreshold ?? Number.NEGATIVE_INFINITY)
    const output = optimizeOptimizerWorkUnit(
      plan,
      command.workIndex,
      {
        scoreThreshold: Number.isFinite(scoreThreshold) ? scoreThreshold : undefined,
        maxEvaluations: command.maxEvaluations
      },
      undefined,
      (progress) => self.postMessage({ type: 'progress', requestId: command.requestId, workIndex: command.workIndex, progress })
    )
    self.postMessage({ type: 'complete', requestId: command.requestId, workIndex: command.workIndex, ...output })
  } catch (error) {
    const requestId = command.type === 'init' ? command.request.requestId : command.requestId
    self.postMessage({ type: 'error', requestId, error: error instanceof Error ? error.message : 'Optimizer failed.' })
  }
}

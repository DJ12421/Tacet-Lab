/// <reference lib="webworker" />
import { createOptimizerWorkPlan, optimizeOptimizerWorkUnit, type OptimizerCandidateEvaluator, type OptimizerWorkPlan } from '../domain/optimizer'
import type { OptimizerRequest } from '../domain/types'
import { resolveTeamWorkspace, rotationDamageByMode } from '../ui/team-workspace-model'

type InitCommand = { type: 'init'; request: OptimizerRequest }
type RunCommand = { type: 'run'; requestId: string; workIndex: number; scoreThreshold?: number; maxEvaluations?: number }
type ThresholdCommand = { type: 'threshold'; requestId: string; scoreThreshold?: number }
type OptimizerWorkerCommand = InitCommand | RunCommand | ThresholdCommand

let plan: OptimizerWorkPlan | undefined
let globalScoreThreshold: number | undefined

function rotationEvaluator(request: OptimizerRequest): OptimizerCandidateEvaluator | undefined {
  const rotation = request.rotation
  const baseBuild = request.combat?.build
  if (!rotation || !baseBuild) return undefined
  return (echoes) => {
    const build = { ...baseBuild, echoIds: echoes.map((echo) => echo.id) }
    const members = [...(rotation.team.members ?? [])]
    const member = members[rotation.memberSlot]
    const buildIds = [...rotation.team.buildIds]
    if (member) members[rotation.memberSlot] = { ...member, loadoutSource: { type: 'saved', buildId: build.id } }
    else buildIds[rotation.memberSlot] = build.id
    const model = resolveTeamWorkspace({
      ...rotation,
      team: { ...rotation.team, buildIds, ...(member ? { members } : {}) },
      builds: [...rotation.builds.filter((entry) => entry.id !== build.id), build],
      echoes: request.echoes
    })
    const totals = rotationDamageByMode(model)
    const mode = rotation.team.scenario?.resultMode ?? 'expected'
    return { score: totals[mode], damage: { ...totals, hits: model.actions.length, attackId: rotation.targetId } }
  }
}

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
        maxEvaluations: command.maxEvaluations,
        evaluateCandidate: rotationEvaluator(plan.request)
      },
      (progress) => self.postMessage({ type: 'progress', requestId: command.requestId, workIndex: command.workIndex, progress })
    )
    self.postMessage({ type: 'complete', requestId: command.requestId, workIndex: command.workIndex, ...output })
  } catch (error) {
    const requestId = command.type === 'init' ? command.request.requestId : command.requestId
    self.postMessage({ type: 'error', requestId, error: error instanceof Error ? error.message : 'Optimizer failed.' })
  }
}

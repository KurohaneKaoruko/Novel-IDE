import type { MutableRefObject } from 'react'
import type { NovelTask, PlannerContextPack, WriterMode } from './NovelPlannerService'
import type { FsEntry } from '../tauri'
import type { StreamMapRefs } from './streamRefs'
import { cleanupStreamRefs } from './streamRefs'

type PlannerServiceLike = {
  loadRunQueue: () => Promise<NovelTask[]>
  updateTask: (
    mode: WriterMode,
    taskId: string,
    updater: (task: NovelTask) => NovelTask,
  ) => Promise<NovelTask[]>
  setSessionTaskPointer: (sessionId: string, taskId: string | null, error: string | null) => Promise<void>
  appendContinuityEntry: (task: NovelTask, summary: string) => Promise<void>
  getNextExecutableTask: (tasks: NovelTask[]) => NovelTask | null
  buildModeContext: (mode: WriterMode, tree: FsEntry | null, activePath: string | null) => Promise<PlannerContextPack>
  buildTaskExecutionPrompt: (mode: WriterMode, task: NovelTask, context: PlannerContextPack, userInstruction: string) => string
}

type TaskQualityResult = {
  ok: boolean
  reason: string | null
}

export type RunPlannerQueueArgs = {
  workspaceRoot: string | null
  isTauriRuntime: boolean
  writerMode: WriterMode
  plannerQueueRunning: boolean
  plannerStopRef: MutableRefObject<boolean>
  chatSessionId: string
  tree: FsEntry | null
  activePath: string | null
  userInstruction: string
  streamRefs: StreamMapRefs
  plannerService: PlannerServiceLike
  setPlannerQueueRunning: (v: boolean) => void
  setPlannerLastRunError: (v: string | null) => void
  setPlannerBusy: (v: boolean) => void
  setPlannerTasks: (tasks: NovelTask[]) => void
  ensurePlanningArtifacts: (mode: WriterMode, instruction?: string) => Promise<void>
  onSendChat: (content: string, options?: { skipModeWrap?: boolean }) => Promise<string | null>
  waitForStreamCompletion: (streamId: string) => Promise<void>
  validateTaskQuality: (task: NovelTask, assistantText: string, taskPool: NovelTask[]) => Promise<TaskQualityResult>
  extractTaskSummaryFromMessage: (text: string) => string
  refreshTree: () => Promise<void>
}

export async function runPlannerQueueWorkflow(args: RunPlannerQueueArgs): Promise<void> {
  const {
    workspaceRoot,
    isTauriRuntime,
    writerMode,
    plannerQueueRunning,
    plannerStopRef,
    chatSessionId,
    tree,
    activePath,
    userInstruction,
    streamRefs,
    plannerService,
    setPlannerQueueRunning,
    setPlannerLastRunError,
    setPlannerBusy,
    setPlannerTasks,
    ensurePlanningArtifacts,
    onSendChat,
    waitForStreamCompletion,
    validateTaskQuality,
    extractTaskSummaryFromMessage,
    refreshTree,
  } = args

  if (!workspaceRoot || !isTauriRuntime) return
  if (writerMode === 'normal') {
    setPlannerLastRunError('普通模式不执行细纲队列')
    return
  }
  if (plannerQueueRunning) return

  setPlannerQueueRunning(true)
  setPlannerLastRunError(null)
  plannerStopRef.current = false
  setPlannerBusy(true)

  try {
    await ensurePlanningArtifacts(writerMode, userInstruction)
    let tasks = await plannerService.loadRunQueue()
    setPlannerTasks(tasks)
    let guard = 0
    while (!plannerStopRef.current) {
      guard += 1
      if (guard > 400) break
      const next = plannerService.getNextExecutableTask(tasks)
      if (!next) break

      await plannerService.setSessionTaskPointer(chatSessionId, next.id, null)
      tasks = await plannerService.updateTask(writerMode, next.id, (task) => ({
        ...task,
        status: 'running',
        last_error: undefined,
      }))
      setPlannerTasks(tasks)

      const context = await plannerService.buildModeContext(writerMode, tree, next.scope || activePath)
      const taskPrompt = plannerService.buildTaskExecutionPrompt(writerMode, next, context, userInstruction)
      const streamId = await onSendChat(taskPrompt, { skipModeWrap: true })
      if (!streamId) {
        throw new Error(`任务 ${next.id} 无法启动`)
      }
      await waitForStreamCompletion(streamId)
      const latestAssistant = streamRefs.streamOutputRef.current.get(streamId) ?? ''
      cleanupStreamRefs(streamRefs, streamId)

      const quality = await validateTaskQuality(next, latestAssistant, tasks)
      if (!quality.ok) {
        tasks = await plannerService.updateTask(writerMode, next.id, (task) => ({
          ...task,
          status: task.retries >= 1 ? 'blocked' : 'retry',
          retries: task.retries + 1,
          last_error: quality.reason ?? '质量校验失败',
        }))
        setPlannerTasks(tasks)
        if ((tasks.find((task) => task.id === next.id)?.status ?? '') === 'blocked') {
          throw new Error(`任务 ${next.id} 已阻塞：${quality.reason ?? '未知错误'}`)
        }
        continue
      }

      const summary = extractTaskSummaryFromMessage(latestAssistant)
      tasks = await plannerService.updateTask(writerMode, next.id, (task) => ({
        ...task,
        status: 'done',
        completed_at: new Date().toISOString(),
        last_error: undefined,
      }))
      await plannerService.appendContinuityEntry(next, summary || '任务完成')
      await plannerService.setSessionTaskPointer(chatSessionId, null, null)
      setPlannerTasks(tasks)
      await refreshTree()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setPlannerLastRunError(msg)
    await plannerService.setSessionTaskPointer(chatSessionId, null, msg)
  } finally {
    plannerStopRef.current = false
    setPlannerQueueRunning(false)
    setPlannerBusy(false)
  }
}

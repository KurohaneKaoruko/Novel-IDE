import type { MutableRefObject } from 'react'
import type { NovelTask, WriterMode } from './NovelPlannerService'
import type { StreamMapRefs } from './streamRefs'
import { cleanupStreamRefs } from './streamRefs'

type OpenFileLike = {
  path: string
  content: string
}

type ChatItemLike = {
  streaming?: boolean
}

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
}

type TaskQualityResult = {
  ok: boolean
  reason: string | null
}

export type RunAutoLongWriteArgs = {
  workspaceRoot: string | null
  isTauriRuntime: boolean
  activeFile: { path: string } | null
  activePath: string | null
  autoLongWriteRunning: boolean
  openFiles: OpenFileLike[]
  writerMode: WriterMode
  chapterWordTarget: number
  autoLongWriteMaxRounds: number
  autoLongWriteMinChars: number
  autoLongWriteMaxChars: number
  autoLongWriteMaxChapterAdvances: number
  chatSessionId: string
  autoLongWriteStopRef: MutableRefObject<boolean>
  chatMessagesRef: MutableRefObject<ChatItemLike[]>
  streamRefs: StreamMapRefs
  plannerService: PlannerServiceLike
  setPlannerTasks: (tasks: NovelTask[]) => void
  setAutoLongWriteRunning: (v: boolean) => void
  setAutoLongWriteStatus: (v: string) => void
  setAutoLongWriteEnabled: (v: boolean) => void
  setError: (v: string) => void
  ensurePlanningArtifacts: (mode: WriterMode) => Promise<void>
  ensureAutoStoryFile: (path: string) => Promise<string | null>
  ensureAutoNextChapter: (path: string) => Promise<string | null>
  getLatestFileCharCount: (path: string, fallback?: string) => Promise<number>
  onSendChat: (content: string, options?: { hideUserEcho?: boolean; skipModeWrap?: boolean }) => Promise<string | null>
  waitForStreamCompletion: (streamId: string) => Promise<void>
  validateTaskQuality: (task: NovelTask, assistantText: string, taskPool: NovelTask[]) => Promise<TaskQualityResult>
  extractTaskSummaryFromMessage: (text: string) => string
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

export async function runAutoLongWriteWorkflow(args: RunAutoLongWriteArgs): Promise<void> {
  const {
    workspaceRoot,
    isTauriRuntime,
    activeFile,
    activePath,
    autoLongWriteRunning,
    openFiles,
    writerMode,
    chapterWordTarget,
    autoLongWriteMaxRounds,
    autoLongWriteMinChars,
    autoLongWriteMaxChars,
    autoLongWriteMaxChapterAdvances,
    chatSessionId,
    autoLongWriteStopRef,
    chatMessagesRef,
    streamRefs,
    plannerService,
    setPlannerTasks,
    setAutoLongWriteRunning,
    setAutoLongWriteStatus,
    setAutoLongWriteEnabled,
    setError,
    ensurePlanningArtifacts,
    ensureAutoStoryFile,
    ensureAutoNextChapter,
    getLatestFileCharCount,
    onSendChat,
    waitForStreamCompletion,
    validateTaskQuality,
    extractTaskSummaryFromMessage,
  } = args

  if (!workspaceRoot || !isTauriRuntime) return
  if (!activeFile) return
  if (autoLongWriteRunning) return
  if (chatMessagesRef.current.some((m) => m.streaming)) return

  let targetPath = activeFile.path
  let chapterAdvances = 0
  let reachedTarget = false
  let stalledRounds = 0
  let autoTaskCursor: NovelTask | null = null
  let lastAssistantText = ''
  autoLongWriteStopRef.current = false
  setAutoLongWriteRunning(true)
  setAutoLongWriteStatus('Auto running...')

  try {
    for (let round = 1; round <= autoLongWriteMaxRounds; round += 1) {
      if (autoLongWriteStopRef.current) break
      if (activePath !== targetPath) {
        setAutoLongWriteStatus('Auto stopped: active file changed.')
        break
      }

      const fallbackContent = openFiles.find((f) => f.path === targetPath)?.content ?? ''
      if (writerMode !== 'normal') {
        await ensurePlanningArtifacts(writerMode)
        let queue = await plannerService.loadRunQueue()
        setPlannerTasks(queue)
        const runningOnPath = queue.find(
          (task) => task.scope === targetPath && (task.status === 'running' || task.status === 'todo' || task.status === 'retry'),
        )
        const nextExecutable = plannerService.getNextExecutableTask(queue)
        const selectedTask = runningOnPath ?? nextExecutable
        if (!selectedTask) {
          reachedTarget = true
          break
        }

        if (selectedTask.scope !== targetPath) {
          const switched = await ensureAutoStoryFile(selectedTask.scope)
          if (!switched) {
            reachedTarget = true
            break
          }
          chapterAdvances += 1
          targetPath = switched
          setAutoLongWriteStatus(`Auto task switch -> ${selectedTask.id} @ ${switched}`)
          await sleep(220)
          continue
        }

        autoTaskCursor = selectedTask
        if (selectedTask.status !== 'running') {
          queue = await plannerService.updateTask(writerMode, selectedTask.id, (task) => ({
            ...task,
            status: 'running',
            last_error: undefined,
          }))
          setPlannerTasks(queue)
        }
        await plannerService.setSessionTaskPointer(chatSessionId, selectedTask.id, null)
      } else {
        autoTaskCursor = null
      }
      const currentCount = await getLatestFileCharCount(targetPath, fallbackContent)
      const targetCount = Math.max(0, autoTaskCursor?.target_words ?? chapterWordTarget)
      if (targetCount > 0 && currentCount >= targetCount) {
        if (autoTaskCursor) {
          setAutoLongWriteStatus(`Auto validating ${autoTaskCursor.id}...`)
          const finalPrompt =
            `Task completion check.\n` +
            `Task: ${autoTaskCursor.id} ${autoTaskCursor.title}\n` +
            `Target file: #file:${targetPath}\n` +
            `Target words: ${targetCount}\n` +
            `If task is complete, output exactly: TASK_DONE: ${autoTaskCursor.id}\n` +
            `Then provide a 2-3 sentence summary.\n` +
            `If not complete, first apply missing edits to file, then output TASK_DONE tag and summary.`
          const finalStreamId = await onSendChat(finalPrompt, { hideUserEcho: true, skipModeWrap: true })
          if (!finalStreamId) {
            throw new Error(`任务 ${autoTaskCursor.id} 完成确认启动失败`)
          }
          try {
            await waitForStreamCompletion(finalStreamId)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (/cancel/i.test(msg)) break
            throw e
          }
          const finalAssistantText = (streamRefs.streamOutputRef.current.get(finalStreamId) ?? lastAssistantText).trim()
          cleanupStreamRefs(streamRefs, finalStreamId)

          let queue = await plannerService.loadRunQueue()
          const quality = await validateTaskQuality(autoTaskCursor, finalAssistantText, queue)
          if (!quality.ok) {
            queue = await plannerService.updateTask(writerMode, autoTaskCursor.id, (task) => ({
              ...task,
              status: task.retries >= 1 ? 'blocked' : 'retry',
              retries: task.retries + 1,
              last_error: quality.reason ?? '质量校验失败',
            }))
            setPlannerTasks(queue)
            await plannerService.setSessionTaskPointer(chatSessionId, autoTaskCursor.id, quality.reason ?? null)
            const nowStatus = queue.find((task) => task.id === autoTaskCursor?.id)?.status
            if (nowStatus === 'blocked') {
              setAutoLongWriteStatus(`Auto blocked: ${autoTaskCursor.id} ${quality.reason ?? ''}`.trim())
              break
            }
            setAutoLongWriteStatus(`Auto retry: ${autoTaskCursor.id} ${quality.reason ?? ''}`.trim())
            continue
          }

          const summary = extractTaskSummaryFromMessage(finalAssistantText) || `Auto reached target words (${currentCount}/${targetCount})`
          queue = await plannerService.updateTask(writerMode, autoTaskCursor.id, (task) => ({
            ...task,
            status: 'done',
            completed_at: new Date().toISOString(),
            last_error: undefined,
          }))
          await plannerService.appendContinuityEntry(autoTaskCursor, summary)
          await plannerService.setSessionTaskPointer(chatSessionId, null, null)
          setPlannerTasks(queue)
          const nextTask = plannerService.getNextExecutableTask(queue)
          if (!nextTask) {
            reachedTarget = true
            break
          }
          const switched = await ensureAutoStoryFile(nextTask.scope)
          if (!switched) {
            reachedTarget = true
            break
          }
          chapterAdvances += 1
          targetPath = switched
          autoTaskCursor = null
          setAutoLongWriteStatus(`Auto task done ${nextTask.id} -> ${switched}`)
          await sleep(220)
          continue
        }
        if (chapterAdvances >= autoLongWriteMaxChapterAdvances) {
          setAutoLongWriteStatus('Auto paused: chapter auto-advance limit reached.')
          break
        }
        const nextPath = await ensureAutoNextChapter(targetPath)
        if (!nextPath) {
          reachedTarget = true
          break
        }
        chapterAdvances += 1
        targetPath = nextPath
        setAutoLongWriteStatus(`Auto advanced to ${nextPath} (chapter ${chapterAdvances + 1})`)
        await sleep(220)
        continue
      }

      const gap = targetCount > 0 ? Math.max(0, targetCount - currentCount) : 1200
      const chunkChars = Math.max(autoLongWriteMinChars, Math.min(autoLongWriteMaxChars, gap > 0 ? gap : 1200))
      const progressLabel = targetCount > 0 ? `${currentCount}/${targetCount}` : `${currentCount}`
      setAutoLongWriteStatus(`Auto round ${round} - ${progressLabel}`)

      const modeGuard =
        writerMode === 'normal'
          ? 'Use current chapter context and referenced files only.'
          : writerMode === 'plan'
            ? 'Follow the major outline and chapter pacing strictly.'
            : 'Follow the detailed outline tasks and beat continuity strictly.'

      const prompt =
        `Auto long-form writing task.\n` +
        `Current chapter file: #file:${targetPath}\n` +
        `Current length: ${currentCount} chars.\n` +
        `Mode: ${writerMode}.\n` +
        (targetCount > 0 ? `Target length: ${targetCount} chars.\n` : '') +
        (autoTaskCursor ? `Task: ${autoTaskCursor.id} ${autoTaskCursor.title}\n` : '') +
        `Write and apply about ${chunkChars} new chars directly into the file.\n` +
        `Requirements:\n` +
        `1) Must use file-edit tool to modify project files directly (no insert button flow).\n` +
        `2) Keep plot logic consistent with existing chapters and avoid contradictions.\n` +
        `3) ${modeGuard}\n` +
        `4) No duplicate paragraphs; continue exactly from the current ending.\n` +
        `5) Return a one-line progress summary after applying edits.`

      const streamId = await onSendChat(prompt, { hideUserEcho: true })
      if (!streamId) {
        await sleep(160)
        continue
      }

      try {
        await waitForStreamCompletion(streamId)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/cancel/i.test(msg)) {
          break
        }
        throw e
      }
      lastAssistantText = (streamRefs.streamOutputRef.current.get(streamId) ?? '').trim()
      cleanupStreamRefs(streamRefs, streamId)

      await sleep(280)
      const nextCount = await getLatestFileCharCount(targetPath, fallbackContent)
      if (nextCount <= currentCount + 20) {
        stalledRounds += 1
        if (stalledRounds >= 3) {
          setAutoLongWriteStatus('Auto paused: no measurable file growth.')
          break
        }
      } else {
        stalledRounds = 0
      }
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e))
    setAutoLongWriteStatus('Auto failed.')
  } finally {
    const stoppedByUser = autoLongWriteStopRef.current
    if (reachedTarget) {
      setAutoLongWriteStatus(
        writerMode === 'normal' ? 'Auto completed: chapter target reached.' : 'Auto completed: planner queue reached target.',
      )
    } else if (stoppedByUser) {
      setAutoLongWriteStatus('Auto stopped.')
    }
    autoLongWriteStopRef.current = false
    setAutoLongWriteRunning(false)
    setAutoLongWriteEnabled(false)
    window.setTimeout(() => {
      setAutoLongWriteStatus('')
    }, 3500)
  }
}

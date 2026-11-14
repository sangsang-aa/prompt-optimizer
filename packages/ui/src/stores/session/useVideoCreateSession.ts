/**
 * Video-Create Session Store
 *
 * 只保存视频模式第一版需要的最小现场：要求文本、优化结果占位、模型/模板选择。
 * 参考图、参数、生成任务等后续切片再补；视频字节永远不进这里（见设计文档 §3.5）。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getPiniaServices } from '../../plugins/pinia'
import {
  createSessionSnapshotWriter,
  readSessionSnapshot,
  runSessionWrite,
  type SessionWritePermit,
} from './sessionPersistence'

export const VIDEO_CREATE_SESSION_KEY = 'session/v1/video-create'

export interface VideoCreateSessionState {
  originalPrompt: string
  optimizedPrompt: string
  selectedTextModelKey: string
  selectedTemplateId: string | null
  lastActiveAt: number
}

export const createDefaultVideoCreateState = (): VideoCreateSessionState => ({
  originalPrompt: '',
  optimizedPrompt: '',
  selectedTextModelKey: '',
  selectedTemplateId: null,
  lastActiveAt: Date.now(),
})

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const normalizeState = (value: unknown): VideoCreateSessionState => {
  const fallback = createDefaultVideoCreateState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const data = value as Record<string, unknown>
  return {
    originalPrompt: asString(data.originalPrompt),
    optimizedPrompt: asString(data.optimizedPrompt),
    selectedTextModelKey: asString(data.selectedTextModelKey),
    selectedTemplateId: typeof data.selectedTemplateId === 'string' ? data.selectedTemplateId : null,
    lastActiveAt: typeof data.lastActiveAt === 'number' && Number.isFinite(data.lastActiveAt)
      ? data.lastActiveAt
      : fallback.lastActiveAt,
  }
}

export const useVideoCreateSession = defineStore('video-create-session', () => {
  const state = ref<VideoCreateSessionState>(createDefaultVideoCreateState())

  const writer = createSessionSnapshotWriter(
    () => state.value as unknown as Record<string, unknown>,
  )

  const reset = () => {
    state.value = createDefaultVideoCreateState()
  }

  const restoreSession = async () => {
    const service = getPiniaServices()?.preferenceService
    if (!service) return
    const snapshot = await readSessionSnapshot<unknown>(
      service,
      VIDEO_CREATE_SESSION_KEY,
      null,
    )
    // A missing snapshot must keep the writable baseline at null; otherwise the
    // first autosave compares against a fabricated default and reports a conflict.
    if (snapshot) state.value = normalizeState(snapshot)
    writer.restored(service, VIDEO_CREATE_SESSION_KEY)
  }

  const saveSession = async (permit?: SessionWritePermit): Promise<boolean> => {
    const service = getPiniaServices()?.preferenceService
    if (!service) return false
    const captured = writer.capture()
    return runSessionWrite(
      service,
      () => writer.write(service, VIDEO_CREATE_SESSION_KEY, { ...state.value }, captured),
      permit,
    )
  }

  return { state, reset, restoreSession, saveSession }
})

export type VideoCreateSessionApi = ReturnType<typeof useVideoCreateSession>

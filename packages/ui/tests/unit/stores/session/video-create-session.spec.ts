import { describe, expect, it } from 'vitest'
import { MemoryStorageProvider, PreferenceService } from '@prompt-optimizer/core'
import { createTestPinia } from '../../../utils/pinia-test-helpers'
import { setPiniaServices } from '../../../../src/plugins/pinia'
import {
  VIDEO_CREATE_SESSION_KEY,
  useVideoCreateSession,
} from '../../../../src/stores/session/useVideoCreateSession'
import { hasSessionConflicts } from '../../../../src/stores/session/sessionPersistence'

const createWindow = (storage: MemoryStorageProvider) => {
  const preferences = new PreferenceService(storage)
  const context = createTestPinia({ preferenceService: preferences })
  const activate = () => { setPiniaServices(context.services) }
  return { ...context, preferences, activate }
}

describe('video-create session', () => {
  it('saves the first draft without reporting a cross-window conflict', async () => {
    const storage = new MemoryStorageProvider()
    const first = createWindow(storage)
    const store = useVideoCreateSession(first.pinia)
    await store.restoreSession()
    expect(await first.preferences.get(VIDEO_CREATE_SESSION_KEY, null)).toBeNull()

    store.state.originalPrompt = '一只黑猫在雨夜的街头走路'
    expect(await store.saveSession()).toBe(true)
    expect(hasSessionConflicts(first.preferences)).toBe(false)
    expect(await first.preferences.get(VIDEO_CREATE_SESSION_KEY, null)).toMatchObject({
      originalPrompt: '一只黑猫在雨夜的街头走路',
      optimizedPrompt: '',
      selectedTemplateId: null,
    })
  })

  it('restores the persisted draft in another window', async () => {
    const storage = new MemoryStorageProvider()
    const first = createWindow(storage)
    const store = useVideoCreateSession(first.pinia)
    await store.restoreSession()
    store.state.originalPrompt = '城市夜景，手持跟拍'
    store.state.selectedTextModelKey = 'text-config'
    expect(await store.saveSession()).toBe(true)

    const second = createWindow(storage)
    second.activate()
    const restored = useVideoCreateSession(second.pinia)
    await restored.restoreSession()
    expect(restored.state.originalPrompt).toBe('城市夜景，手持跟拍')
    expect(restored.state.selectedTextModelKey).toBe('text-config')
  })
})

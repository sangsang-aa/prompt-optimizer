<template>
  <section class="video-workspace" data-testid="video-workspace">
    <header class="video-workspace__header">
      <h1 class="video-workspace__title">{{ t('video.title') }}</h1>
      <p class="video-workspace__hint">{{ t('video.hint') }}</p>
    </header>

    <div class="video-workspace__body">
      <div class="video-workspace__panel">
        <label class="video-workspace__label" for="video-brief">{{ t('video.promptLabel') }}</label>
        <textarea
          id="video-brief"
          v-model="brief"
          class="video-workspace__textarea"
          data-testid="video-brief"
          :placeholder="t('video.placeholder')"
          rows="8"
        />
      </div>

      <aside class="video-workspace__panel video-workspace__panel--result">
        <div class="video-workspace__empty" data-testid="video-result-empty">
          {{ t('video.resultEmpty') }}
        </div>
        <button class="video-workspace__button" type="button" disabled>
          {{ t('video.generate') }}
        </button>
        <p class="video-workspace__note">{{ t('video.comingSoon') }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVideoCreateSession } from '../../stores/session/useVideoCreateSession'

const { t } = useI18n()
const session = useVideoCreateSession()

const brief = computed({
  get: () => session.state.originalPrompt,
  set: (value: string) => {
    session.state.originalPrompt = value
  },
})
</script>

<style scoped>
.video-workspace {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  height: 100%;
  box-sizing: border-box;
}

.video-workspace__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.video-workspace__hint {
  margin: 6px 0 0;
  color: var(--text-color-3, #888);
  font-size: 13px;
}

.video-workspace__body {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.video-workspace__panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border-color, #e0e0e6);
  border-radius: 10px;
  min-width: 0;
}

.video-workspace__label {
  font-size: 13px;
  font-weight: 600;
}

.video-workspace__textarea {
  flex: 1;
  min-height: 180px;
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e0e0e6);
  border-radius: 8px;
  font: inherit;
  line-height: 1.5;
  background: transparent;
  color: inherit;
  box-sizing: border-box;
}

.video-workspace__panel--result {
  justify-content: space-between;
}

.video-workspace__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  border: 1px dashed var(--border-color, #e0e0e6);
  border-radius: 8px;
  color: var(--text-color-3, #888);
  font-size: 13px;
}

.video-workspace__button {
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  background: var(--primary-color, #4f6ef7);
  color: #fff;
  font-size: 14px;
  cursor: not-allowed;
  opacity: 0.5;
}

.video-workspace__note {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-color-3, #888);
}

@media (max-width: 720px) {
  .video-workspace {
    padding: 16px;
  }

  .video-workspace__body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

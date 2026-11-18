<template>
  <section class="news-settings" data-news-settings-panel>
    <header class="news-settings-head">
      <h2>{{ t('news.settings.title') }}</h2>
      <button type="button" class="news-btn" data-news-settings-back @click="emit('close')">
        {{ t('news.toolbar.back') }}
      </button>
    </header>

    <div class="news-settings-group" data-news-settings-sources>
      <h3>{{ t('news.settings.sources') }}</h3>
      <p>{{ t('news.settings.notWired') }}</p>
    </div>
    <div class="news-settings-group" data-news-settings-circles>
      <h3>{{ t('news.settings.circles') }}</h3>
      <p>{{ t('news.settings.notWired') }}</p>
    </div>
    <div class="news-settings-group" data-news-settings-general>
      <h3>{{ t('news.settings.general') }}</h3>
      <p>{{ t('news.settings.notWired') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 设置页（v1 骨架）：源 / 圈子 / 抓取与显示三个分区。
 *
 * 分区内容尚未接入命令面——这里只显示明确说明，不摆假开关（避免用户以为
 * 配置已生效）。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

const emit = defineEmits<{ close: [] }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)
</script>

<style scoped>
.news-settings {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 24px 44px;
}
.news-settings-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.news-settings-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
}
.news-settings-head .news-btn {
  margin-inline-start: auto;
}
.news-settings-group {
  margin-bottom: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card, 10px);
  background: var(--bg-card);
}
.news-settings-group h3 {
  margin: 0 0 3px;
  font-size: 13px;
  font-weight: 600;
}
.news-settings-group p {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.news-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-button, 8px);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12.5px;
  cursor: pointer;
}
.news-btn:hover {
  background: var(--bg-hover);
}
.news-btn:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 2px;
}
</style>
<template>
  <div class="news-mobile-settings" data-news-mobile-settings-page>
    <div class="news-ms-group">
      <h3>{{ t('news.settings.sources') }}</h3>
      <p>{{ t('news.settings.notWired') }}</p>
    </div>
    <div class="news-ms-group">
      <h3>{{ t('news.settings.circles') }}</h3>
      <p>{{ t('news.settings.notWired') }}</p>
    </div>
    <div class="news-ms-group">
      <h3>{{ t('news.settings.general') }}</h3>
      <p>{{ t('news.settings.notWired') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置二级页（v1 骨架）：由宿主二级页容器承载（header: true），内容只说明
 * 尚未接入，不摆假开关。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)
</script>

<style scoped>
.news-mobile-settings {
  padding: 14px 14px 28px;
}
.news-ms-group {
  margin-bottom: 12px;
  padding: 14px 16px;
  border: 1px solid var(--news-border, #2e2a22);
  border-radius: 10px;
  background: var(--news-bg-card, #1d1a15);
}
.news-ms-group h3 {
  margin: 0 0 3px;
  font-size: 13px;
  font-weight: 600;
  color: var(--news-text-primary, #ece8dc);
}
.news-ms-group p {
  margin: 0;
  font-size: 11.5px;
  color: var(--news-text-tertiary, #948c79);
}
</style>
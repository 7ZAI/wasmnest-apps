<template>
  <div class="news-root">
    <NewsView :version="version" :env="env" />
  </div>
</template>

<script setup lang="ts">
/** News 桌面挂载包根组件（界面主体在 NewsView）。 */
import { inject } from 'vue'
import NewsView from './components/NewsView.vue'
import { APP_VERSION } from './version'

const version = APP_VERSION
const env = inject<{ invoke: <T = unknown>(c: string, a?: Record<string, unknown>) => Promise<T> }>(
  'appMountEnv',
)
</script>

<style scoped>
.news-root {
  height: 100%;
  width: 100%;
  min-height: 0;
}
</style>

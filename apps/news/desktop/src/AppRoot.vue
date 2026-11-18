<template>
  <div class="news-root">
    <NewsView />
  </div>
</template>

<script setup lang="ts">
/** News 桌面挂载包根组件（界面主体在 NewsView）。 */
import NewsView from './components/NewsView.vue'
</script>

<style scoped>
.news-root {
  height: 100%;
  width: 100%;
  min-height: 0;
}
</style>
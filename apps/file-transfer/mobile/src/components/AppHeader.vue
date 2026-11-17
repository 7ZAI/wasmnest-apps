<script setup lang="ts">
/**
 * AppHeader — 应用顶栏：页面标题
 *
 * 顶栏只回答「当前在哪一页」：设备连接状态在探索连接页的设备行里表达，
 * 发送入口常驻底栏上方（整宽主操作），顶栏不再承载对端胶囊与发送按钮。
 */
defineProps<{
  /** 页面标题（= 底栏一级页文案） */
  title: string
}>()
</script>

<template>
  <header class="fv2-top">
    <h1 class="fv2-top-title">{{ title }}</h1>
  </header>
</template>

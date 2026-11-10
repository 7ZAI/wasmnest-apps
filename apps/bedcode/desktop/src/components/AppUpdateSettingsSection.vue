<script setup lang="ts">
/**
 * 设置页「版本更新」分组（BedCode）
 *
 * 具体检查 / 展示由 SDK 默认实现负责（宿主统一 GitHub Release 判定）；本组件只做
 * 设置页分组适配：标题由设置页统一渲染，卡片内不再重复标题。
 */
import AppUpdateSection from '@binblink/wasmnest-plugin-sdk-desktop/ui/app-update'
import manifest from '../../plugin.json'
</script>

<template>
  <!-- 当前版本随包内联（与宿主加载的 plugin.json 同源），检查前也能看到版本号 -->
  <AppUpdateSection :current-version="manifest.version" :labels="{ title: '' }" />
</template>

<script setup lang="ts">
/**
 * BottomNav — 应用底部导航（探索连接 / 浏览 / 传输 / 设置）
 *
 * 一级入口从顶部下沉到底栏后，顶栏退回「页面标题 + 活跃对端 + 发送」三件事，
 * 四个入口常驻大拇哥可达区。顺序按产品语气排：先找到设备，再浏览 / 传输。
 *
 * 真机 E2E 契约（改名 = 用例红，见 e2e/mobile/file-transfer-shell.spec.ts）：
 *   - 三个一级页面保留 `mobile-ft-tab-<key>` 与 `aria-pressed`（选中态位）；
 *   - 设置是宿主二级页（`context.ui.openPage('settings')`）而非第四页，因此保留
 *     `mobile-ft-settings` 锚点但**不**给 aria-pressed（永假的按下态会误导读屏）。
 *
 * 角标只表达「有东西要注意」：传输=进行中数量，探索=已发现设备数量。
 *
 * 安全区：Android WebView 的 `env(safe-area-inset-*)` 恒为 0，宿主经 provide
 * 注入 JS 量（`safeArea`，见平台仓 App.vue 的 hostSurfaceEnv）。底部内边距取
 * navigationBar → bottom（与 bedcode 底部导航同口径）；dev-shell 无注入时退化 0。
 */
import { computed, inject, type Ref } from 'vue'
import type { MainTab } from '../types'

const props = defineProps<{
  modelValue: MainTab
  /** 三个页面 + 设置的展示文案（父级翻译后传入，保持本组件无 i18n 依赖） */
  labels: Record<MainTab | 'settings', string>
  /** 传输中数量（>0 时在传输入口显示角标） */
  activeCount: number
  /** 已发现设备数量 */
  deviceCount: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: MainTab): void
  (e: 'settings'): void
}>()

/** 导航项：key 决定锚点与选中态，icon 是 heroicons outline 路径 */
const ITEMS: Array<{ key: MainTab | 'settings'; icon: string }> = [
  // 探索连接：信号弧（发现 = 向外找）
  {
    key: 'devices',
    icon: 'M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12 20h.01',
  },
  // 浏览：文件夹
  {
    key: 'browse',
    icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  },
  // 传输：双向箭头（发送 / 接收）
  {
    key: 'transfers',
    icon: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
  },
  // 设置：齿轮
  {
    key: 'settings',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
]

const safeArea = inject<Ref<{ bottom: number; navigationBar?: number }> | undefined>(
  'safeArea',
  undefined,
)

/** 底部系统条留白（navigationBar 优先：手势条与三键导航高度不同） */
const bottomInset = computed(() => {
  const value = safeArea?.value
  return value?.navigationBar ?? value?.bottom ?? 0
})

/** 角标数量（0 = 不渲染，避免空占位） */
function badgeOf(key: MainTab | 'settings'): number {
  if (key === 'transfers') return props.activeCount
  if (key === 'devices') return props.deviceCount
  return 0
}

/** 角标文案上限：两位数以上折成 99+，防止把图标挤歪 */
function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}

function isActive(key: MainTab | 'settings'): boolean {
  return key !== 'settings' && props.modelValue === key
}

function select(key: MainTab | 'settings'): void {
  if (key === 'settings') {
    emit('settings')
    return
  }
  emit('update:modelValue', key)
}
</script>

<template>
  <nav class="fv2-nav" :style="{ paddingBottom: `${bottomInset}px` }">
    <button
      v-for="item in ITEMS"
      :key="item.key"
      type="button"
      class="fv2-nav-item"
      :class="{ 'fv2-nav-item--active': isActive(item.key) }"
      :aria-pressed="item.key === 'settings' ? undefined : isActive(item.key)"
      :aria-current="isActive(item.key) ? 'page' : undefined"
      :data-testid="item.key === 'settings' ? 'mobile-ft-settings' : `mobile-ft-tab-${item.key}`"
      @click="select(item.key)"
    >
      <span class="fv2-nav-icon">
        <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" :d="item.icon" />
        </svg>
        <span v-if="badgeOf(item.key) > 0" class="fv2-nav-badge">
          {{ badgeText(badgeOf(item.key)) }}
        </span>
      </span>
      <span class="fv2-nav-label">{{ labels[item.key] }}</span>
    </button>
  </nav>
</template>

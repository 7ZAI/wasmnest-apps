<template>
  <div class="settings-page flex flex-col gap-4 px-4 pb-6">
    <p v-if="ctrl.error.value" class="rounded-lg px-3 py-2 text-xs" :style="warnStyle">
      {{ t('settings.loadFailed') }}
    </p>

    <!-- ==================== 业务设置分组 ==================== -->
    <section v-for="group in SETTING_GROUPS" :key="group.id" class="flex flex-col gap-2">
      <h2 class="settings-group-title px-1">{{ t(group.titleKey) }}</h2>
      <div
        class="rounded-[var(--bc-radius-card)] overflow-hidden"
        :style="{ background: 'var(--mobile-bg-card)', border: '1px solid var(--mobile-border)' }"
      >
        <div
          v-for="(item, index) in group.items"
          :key="item.key"
          class="flex items-center justify-between gap-3 px-4 min-h-[52px] py-2.5"
          :style="index > 0 ? { borderTop: '1px solid var(--mobile-group-border)' } : {}"
        >
          <!-- 标签列：选项多到一行放不下时（主色色板 5 档）纵向堆叠，说明文字才不会被挤没 -->
          <div class="flex-1 min-w-0">
            <div
              class="text-[var(--font-size-base)]"
              :style="{ color: 'var(--mobile-text-primary)' }"
            >
              {{ t(item.labelKey) }}
            </div>
            <div
              v-if="item.hintKey"
              class="settings-hint mt-1"
              :style="{ color: 'var(--mobile-text-muted)' }"
            >
              {{ t(item.hintKey) }}
            </div>
          </div>

          <!-- 布尔项：复用应用内开关（终端域 Toggle，契约与宿主设置页一致） -->
          <Toggle
            v-if="item.kind === 'boolean'"
            :model-value="ctrl.values[item.key] === true"
            :disabled="ctrl.saving.value"
            @update:model-value="onToggle(item.key, $event)"
          />

          <!-- 数值项：步进器（StepperControl 收敛件，#18；尺寸随视口流式缩放） -->
          <StepperControl
            v-else-if="item.kind === 'number'"
            :model-value="Number(ctrl.values[item.key])"
            :min="item.min ?? 0"
            :max="item.max ?? Infinity"
            :label="t(item.labelKey)"
            :disabled="ctrl.saving.value"
            class="flex-shrink-0"
            @update:model-value="onStepValue(item.key, $event)"
          />

          <!-- 枚举项：分段选择。flex-wrap 是必需的——主色色板 5 档在窄屏一行放不下，
               不换行会把标签列挤到 0 宽。窄屏时整行换行，宽屏仍保持同行。
               带 swatchPreview 的枚举（主色色板）改为色块 + 文字的单选按钮：
               每个选项一个色点（颜色即选中后的实际主色），选中的色块内打勾、
               单元格高亮——a11y 不靠颜色单通道，文字 / aria-pressed 同步承载。 -->
          <div
            v-else
            class="flex items-center gap-1 flex-shrink-0"
            :class="(item.options?.length ?? 0) > 3 ? 'flex-wrap justify-end max-w-[62%]' : ''"
          >
            <template v-if="item.swatchPreview">
              <button
                v-for="opt in item.options ?? []"
                :key="opt.value"
                type="button"
                class="flex flex-col items-center gap-1.5 min-w-[56px] px-2 pt-2 pb-1.5 rounded-[var(--bc-radius-control)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--mobile-accent)] active:opacity-80"
                :aria-pressed="ctrl.values[item.key] === opt.value"
                :data-palette-option="opt.value"
                :disabled="ctrl.saving.value"
                :style="swatchCellStyle(ctrl.values[item.key] === opt.value)"
                @click="onSelect(item.key, opt.value)"
              >
                <span
                  class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  aria-hidden="true"
                  :style="swatchDotStyle(opt.value, ctrl.values[item.key] === opt.value)"
                >
                  <svg
                    v-if="ctrl.values[item.key] === opt.value"
                    class="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span
                  class="text-[var(--font-size-sm)] leading-none whitespace-nowrap"
                  :style="{
                    color:
                      ctrl.values[item.key] === opt.value
                        ? 'var(--mobile-text-primary)'
                        : 'var(--mobile-text-secondary)',
                  }"
                >
                  {{ t(opt.labelKey) }}
                </span>
              </button>
            </template>
            <template v-else>
              <button
                v-for="opt in item.options ?? []"
                :key="opt.value"
                type="button"
                class="min-h-[36px] px-3 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] transition-colors"
                :aria-pressed="ctrl.values[item.key] === opt.value"
                :style="segmentStyle(ctrl.values[item.key] === opt.value)"
                :disabled="ctrl.saving.value"
                @click="onSelect(item.key, opt.value)"
              >
                {{ t(opt.labelKey) }}
              </button>
            </template>
          </div>
        </div>

        <!-- 生物认证绑定行（仅认证分组）：补齐「绑定生物认证信息」闭环。
             绑定/解绑经宿主生物凭证引擎面，需已认证连接；设备不支持时只读状态不给动作。 -->
        <div
          v-if="group.id === 'auth'"
          class="flex items-center justify-between gap-3 px-4 min-h-[52px] py-2.5"
          :style="{ borderTop: '1px solid var(--mobile-group-border)' }"
          data-testid="mobile-settings-biometric-row"
        >
          <div class="flex-1 min-w-0">
            <div
              class="text-[var(--font-size-base)]"
              :style="{ color: 'var(--mobile-text-primary)' }"
            >
              {{ t('settings.biometric.title') }}
            </div>
            <div
              v-if="biometricHintKey"
              class="settings-hint mt-1"
              :style="{
                color: biometricHintWarn ? 'var(--mobile-error)' : 'var(--mobile-text-muted)',
              }"
              data-testid="mobile-settings-biometric-status"
            >
              {{ t(biometricHintKey) }}
            </div>
          </div>

          <!-- 已绑定 → 解绑；支持但未绑定 → 绑定；不支持 → 无动作 -->
          <button
            v-if="bio.hasKey.value"
            type="button"
            class="min-h-[36px] px-4 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] font-medium transition-colors flex-shrink-0 active:opacity-80"
            :style="{
              background: 'var(--mobile-bg-primary)',
              color: 'var(--mobile-error)',
              border: '1px solid var(--mobile-border)',
            }"
            :disabled="!bio.canUnbind.value"
            data-testid="mobile-settings-biometric-unbind"
            @click="onUnbindBiometric"
          >
            {{
              bio.busy.value ? t('settings.biometric.unbinding') : t('settings.biometric.unbind')
            }}
          </button>
          <button
            v-else-if="bio.deviceSupported.value"
            type="button"
            class="min-h-[36px] px-4 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] font-medium transition-colors flex-shrink-0 active:opacity-80"
            :style="{ background: 'var(--mobile-accent)', color: 'var(--mobile-text-on-accent)' }"
            :disabled="!bio.canBind.value"
            data-testid="mobile-settings-biometric-bind"
            @click="onBindBiometric"
          >
            {{ bio.busy.value ? t('settings.biometric.binding') : t('settings.biometric.bind') }}
          </button>
        </div>
      </div>
    </section>

    <!-- ==================== 重置 ==================== -->
    <button
      type="button"
      class="min-h-[52px] rounded-[var(--bc-radius-card)] text-[var(--font-size-base)] font-medium transition-colors active:opacity-80"
      :style="{
        background: 'var(--mobile-bg-card)',
        border: '1px solid var(--mobile-border)',
        color: 'var(--mobile-error)',
      }"
      :disabled="ctrl.saving.value"
      @click="onReset"
    >
      {{ t('settings.actions.reset') }}
    </button>

    <!-- 版本更新（SDK 默认实现；宿主统一 GitHub Release 判定）——
         固定放在页面最后；版本号随包内联，检查前也能看到 -->
    <AppUpdateSection :current-version="manifest.version" />
  </div>
</template>

<script setup lang="ts">
/**
 * 业务设置页（票 2026-10-10：全量 UI 下沉 —— 设置域）
 *
 * 本页只管**业务设置**（连接策略 / 通知 / 终端上限 / 首选认证）。
 * 平台设置（外观、语言、字号缩放、关于、出站授权、链路加密）由宿主壳持有，
 * 见 spec §2 设置切分口径——本页不重复实现，也不另加底部去处说明。
 *
 * 数据面：useAppSettings（宿主通用 KV 桥）；本组件不直连任何 Tauri 命令。
 */
import { computed, onMounted } from 'vue'
import AppUpdateSection from '@binblink/wasmnest-plugin-sdk-mobile/ui/app-update'
import manifest from '../../plugin.json'
import Toggle from '../terminal/components/Toggle.vue'
import StepperControl from '../terminal/components/StepperControl.vue'
import { SETTING_GROUPS, SETTINGS_BY_KEY } from './settingsModel'
import { useAppSettings } from './useAppSettings'
import { useBiometricBinding } from './useBiometricBinding'

const ctrl = useAppSettings()
const t = ctrl.t
const bio = useBiometricBinding()

/**
 * 生物绑定行的状态提示文案 key（null = 不显示）。
 * 优先级：探测失败/未读 → 设备不支持（按原因细分）→ 已绑定 → 未认证 → 未绑定。
 */
const biometricHintKey = computed<string | null>(() => {
  const s = bio.status.value
  if (!s) return null
  if (!s.deviceSupported) {
    if (s.deviceReason === 12) return 'settings.biometric.noHardware'
    if (s.deviceReason === 11) return 'settings.biometric.noneEnrolled'
    return 'settings.biometric.unsupported'
  }
  if (s.hasKey) return 'settings.biometric.bound'
  if (!bio.isPaired.value) return 'settings.biometric.needPaired'
  return 'settings.biometric.notBound'
})

/** 提示是否用警示色（设备不支持 / 未认证闸门 → 提醒；其余为中性说明） */
const biometricHintWarn = computed(() => {
  const s = bio.status.value
  if (!s) return false
  return !s.deviceSupported || (!s.hasKey && !bio.isPaired.value)
})

async function onBindBiometric(): Promise<void> {
  try {
    const ok = await bio.bind()
    ctrl.dialogs.showToast(
      ok ? t('settings.biometric.bindDone') : t('settings.biometric.failed'),
      ok ? 'success' : 'error',
    )
  } catch {
    ctrl.dialogs.showToast(t('settings.biometric.failed'), 'error')
  }
}

async function onUnbindBiometric(): Promise<void> {
  const confirmed = await ctrl.dialogs.showConfirm({
    message: t('settings.biometric.unbindConfirm'),
    confirmText: t('settings.biometric.unbind'),
  })
  if (!confirmed) return
  try {
    const ok = await bio.unbind()
    ctrl.dialogs.showToast(
      ok ? t('settings.biometric.unbindDone') : t('settings.biometric.failed'),
      ok ? 'success' : 'error',
    )
  } catch {
    ctrl.dialogs.showToast(t('settings.biometric.failed'), 'error')
  }
}

const warnStyle = {
  background: 'var(--mobile-bg-card)',
  color: 'var(--mobile-error)',
}

function segmentStyle(active: boolean) {
  return {
    background: active ? 'var(--mobile-accent)' : 'var(--mobile-bg-primary)',
    color: active ? 'var(--mobile-text-on-accent)' : 'var(--mobile-text-secondary)',
  }
}

/**
 * 色块选项单元格样式（swatchPreview 枚举项）
 *
 * 选中态用 accent 系 token 高亮单元格；边框两态都存在，避免选中切换造成
 * 1px 布局抖动。选中强调色 = 当前选区的主色（选了哪个档，整页立刻换色），
 * 与 `data-palette` 的实时生效互为印证。
 */
function swatchCellStyle(active: boolean) {
  return {
    background: active ? 'var(--mobile-accent-muted)' : 'transparent',
    border: `1px solid ${active ? 'var(--mobile-accent)' : 'var(--mobile-border)'}`,
  }
}

/**
 * 色块样式：色值取全局 `--mobile-palette-swatch-<value>`（mobile.css 定义，
 * 深/浅色主题各有变体，选择器所见即所改）。选中的色块内勾选图标用
 * `--mobile-text-on-accent`——此时整体 accent 已是该色板，对色号约等于
 * 白/黑字，在任何主色上都清晰。
 */
function swatchDotStyle(value: string, active: boolean) {
  return {
    background: `var(--mobile-palette-swatch-${value})`,
    color: active ? 'var(--mobile-text-on-accent)' : 'transparent',
  }
}

function onToggle(key: string, next: boolean): void {
  void ctrl.set(key, next).catch(() => {
    ctrl.dialogs.showToast(t('settings.saveFailed'), 'error')
  })
}

function onStepValue(key: string, value: number): void {
  void ctrl.set(key, value).catch(() => {
    ctrl.dialogs.showToast(t('settings.saveFailed'), 'error')
  })
}

function onSelect(key: string, value: string): void {
  void ctrl.set(key, value).catch(() => {
    ctrl.dialogs.showToast(t('settings.saveFailed'), 'error')
  })
}

async function onReset(): Promise<void> {
  const confirmed = await ctrl.dialogs.showConfirm({
    message: t('settings.actions.resetConfirm'),
    confirmText: t('settings.actions.reset'),
  })
  if (!confirmed) return
  try {
    await ctrl.reset()
    ctrl.dialogs.showToast(t('settings.actions.resetDone'), 'success')
  } catch {
    ctrl.dialogs.showToast(t('settings.saveFailed'), 'error')
  }
}

onMounted(() => {
  void ctrl.load()
  void bio.refresh()
})

// 防御：定义表里的键必须都能在运行时查到（改表漏改归一会静默写空）
if (import.meta.env.DEV) {
  for (const group of SETTING_GROUPS) {
    for (const item of group.items) {
      if (!SETTINGS_BY_KEY[item.key]) {
        ctrl.logger.error(`[settings] definition table broken: missing index for ${item.key}`)
      }
    }
  }
}
</script>

<style scoped>
/* 分组标题：走与应用其它分组头同一档（小字 / 中等字重 / muted），
   不用 all-caps + 字距，也不靠加粗来分层 */
.settings-group-title {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--mobile-text-muted);
}

.settings-hint {
  font-size: var(--font-size-sm);
  line-height: 1.45;
}
</style>

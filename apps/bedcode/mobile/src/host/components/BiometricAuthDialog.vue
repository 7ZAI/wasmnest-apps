<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto mobile-ui"
        data-bedcode-surface
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-[var(--mobile-overlay-heavy)]" @click="close"></div>

        <!-- Panel -->
        <div
          class="relative w-full max-w-[clamp(280px,384px,440px)] bg-[var(--mobile-bg-card)] border border-[var(--mobile-border)] rounded-[var(--bc-radius-card)] p-6 m-4"
        >
          <!-- Close button -->
          <button
            class="absolute top-3 right-3 flex items-center justify-center w-11 h-11 rounded-[var(--bc-radius-control)] text-[var(--mobile-text-muted)] active:opacity-70 transition-colors"
            @click="close"
          >
            <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <!-- 指纹图标：直接给图标本身（不再套一层主色圆角框——
               弹窗里真正的动作是下面那颗按钮，图标不该先抢一次颜色） -->
          <div class="flex justify-center mt-2 mb-4">
            <svg
              class="w-7 h-7"
              style="color: var(--mobile-text-secondary)"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 8a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
              />
            </svg>
          </div>

          <!-- Title -->
          <h3 class="text-[var(--font-size-xl)] font-semibold text-[var(--mobile-text-primary)] text-center mb-2">
            {{ t('hub.authBiometric') }}
          </h3>
          <p class="text-[var(--mobile-text-muted)] text-center text-[var(--font-size-base)] mb-6 leading-relaxed">
            {{ t('hub.authBiometricDesc') }}
          </p>

          <!-- Error message -->
          <p v-if="error" class="text-[var(--mobile-error)] text-center text-[var(--font-size-base)] mb-4">{{ error }}</p>

          <!-- Verify button -->
          <button
            class="w-full h-12 rounded-[var(--bc-radius-control)] text-[var(--font-size-base)] font-medium transition-opacity duration-200 active:opacity-80"
            :class="
              loading
                ? 'bg-[var(--mobile-bg-elevated)] text-[var(--mobile-text-muted)]'
                : 'bg-[var(--mobile-accent)] text-[var(--mobile-text-on-accent)]'
            "
            :disabled="loading"
            @click="emit('authenticate')"
          >
            <span v-if="loading" class="inline-flex items-center gap-2">
              <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {{ t('hub.biometricAuthenticating') }}
            </span>
            <span v-else>{{ t('hub.biometricVerify') }}</span>
          </button>

          <!-- 切换认证方式：配对码是兜底方式，随时可切回 -->
          <div class="text-center mt-4">
            <button
              class="text-[var(--font-size-sm)] underline underline-offset-2 transition-colors active:opacity-70"
              style="color: var(--mobile-text-secondary)"
              :disabled="loading"
              @click="emit('switch-to-pairing')"
            >
              {{ t('hub.switchToPairing') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 生物认证弹窗（自旧宿主 `src/components/BiometricAuthDialog.vue` 原样迁入插件）
 *
 * 打开时由父组件自动触发系统生物识别；失败/取消后弹窗内展示错误，
 * 可重试指纹验证或经小字链接切换到配对码认证。
 * 文案改由本域 i18n（`hub.*`）取。
 */
import { useHostPage } from '../useHostPage'

const t = useHostPage().t

defineProps<{
  modelValue: boolean
  /** 弹窗内错误提示（生物认证失败等） */
  error?: string
  /** 认证执行中（禁用交互） */
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  authenticate: []
  'switch-to-pairing': []
  close: []
}>()

function close() {
  emit('update:modelValue', false)
  emit('close')
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

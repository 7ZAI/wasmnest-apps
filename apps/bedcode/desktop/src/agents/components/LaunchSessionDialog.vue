<script setup lang="ts">
/**
 * 启动会话弹窗（agent 卡片 → 终端会话的闭环入口）
 *
 * 表单状态与提交链路由 useLaunchSession 持有（配置复用/创建 → session.create →
 * 开终端窗），本组件只做呈现：工作目录 / 环境三选 / 启动命令 + 内联错误。
 * 提交成功向上发 `launched`，由视图层导航到 /sessions。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { UseLaunchSessionReturn } from '../composables/useLaunchSession'

const props = defineProps<{
  launch: UseLaunchSessionReturn
}>()

const emit = defineEmits<{ launched: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const environmentOptions = [
  { value: 'linux', label: t('hub.launch.env.linux') },
  { value: 'wsl2', label: t('hub.launch.env.wsl2') },
  { value: 'windows', label: t('hub.launch.env.windows') },
]

async function onConfirm(): Promise<void> {
  const result = await props.launch.submit()
  if (result) emit('launched')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ah-modal">
      <div
        v-if="launch.open.value"
        class="ah-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-title"
        data-testid="launch-dialog"
        @click.self="launch.close()"
      >
        <div class="ah-modal-panel ah-card">
          <div class="ah-modal-head">
            <h2 id="launch-title" class="ah-modal-title">
              {{ t('hub.launch.title', { name: launch.agent.value?.displayName ?? '' }) }}
            </h2>
            <button
              type="button"
              class="ah-modal-close"
              :aria-label="t('hub.launch.cancel')"
              :title="t('hub.launch.cancel')"
              data-testid="launch-close"
              @click="launch.close()"
            >
              ✕
            </button>
          </div>

          <div class="ah-modal-body">
            <div class="ah-env-row">
              <label class="ah-env-label" for="launch-env">{{ t('hub.launch.env') }}</label>
              <select id="launch-env" v-model="launch.form.environment" class="ah-input">
                <option v-for="opt in environmentOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div class="ah-env-row">
              <label class="ah-env-label" for="launch-dir">{{ t('hub.launch.workingDir') }}</label>
              <div class="ah-launch-dir">
                <input
                  id="launch-dir"
                  v-model="launch.form.workingDir"
                  class="ah-input"
                  type="text"
                  :placeholder="t('hub.launch.workingDirPh')"
                  data-testid="launch-working-dir"
                />
                <button
                  type="button"
                  class="ah-btn ah-btn-ghost ah-btn-sm"
                  data-testid="launch-browse"
                  @click="launch.browseDir()"
                >
                  {{ t('hub.launch.browse') }}
                </button>
              </div>
            </div>

            <div class="ah-env-row">
              <label class="ah-env-label" for="launch-cmd">{{ t('hub.launch.command') }}</label>
              <input
                id="launch-cmd"
                v-model="launch.form.command"
                class="ah-input ah-mono"
                type="text"
                data-testid="launch-command"
              />
            </div>

            <div v-if="launch.error.value" class="ah-cli-error" data-testid="launch-error">
              {{ launch.error.value }}
            </div>
          </div>

          <div class="ah-modal-foot">
            <button
              type="button"
              class="ah-btn ah-btn-ghost"
              data-testid="launch-cancel"
              @click="launch.close()"
            >
              {{ t('hub.launch.cancel') }}
            </button>
            <button
              type="button"
              class="ah-btn ah-btn-primary"
              :disabled="launch.submitting.value"
              data-testid="launch-confirm"
              @click="onConfirm"
            >
              {{ launch.submitting.value ? t('hub.launch.starting') : t('hub.launch.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ah-launch-dir {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.ah-launch-dir .ah-input {
  flex: 1;
}
</style>

<script setup lang="ts">
/**
 * 恢复会话弹窗（日志详情 → CLI resume）
 *
 * 表单状态与提交链路由 useResumeSession 持有（guest 生成恢复命令 →
 * 配置复用/创建 → session.create → 开终端窗），本组件只做呈现：
 * 会话概要 / 工作目录 / 环境三选 / 恢复命令 + 内联错误。
 * 提交成功向上发 `resumed`，由视图层导航到 /sessions。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { UseResumeSessionReturn } from '../composables/useResumeSession'
import AgentIcon from './AgentIcon.vue'

const props = defineProps<{
  resume: UseResumeSessionReturn
}>()

const emit = defineEmits<{ resumed: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const environmentOptions = [
  { value: 'linux', label: t('hub.launch.env.linux') },
  { value: 'wsl2', label: t('hub.launch.env.wsl2') },
  { value: 'windows', label: t('hub.launch.env.windows') },
]

async function onConfirm(): Promise<void> {
  const result = await props.resume.submit()
  if (result) emit('resumed')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ah-modal">
      <div
        v-if="resume.open.value"
        class="ah-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-title"
        data-testid="resume-dialog"
        @click.self="resume.close()"
      >
        <div class="ah-modal-panel ah-card">
          <div class="ah-modal-head">
            <h2 id="resume-title" class="ah-modal-title">
              {{ t('hub.lg.resume.title', { name: resume.agentName.value }) }}
            </h2>
            <button
              type="button"
              class="ah-modal-close"
              :aria-label="t('hub.launch.cancel')"
              :title="t('hub.launch.cancel')"
              data-testid="resume-close"
              @click="resume.close()"
            >
              ✕
            </button>
          </div>

          <div class="ah-modal-body">
            <!-- 会话概要：给用户确认「恢复的是哪一条」 -->
            <div class="ah-env-row">
              <span class="ah-env-label">{{ t('hub.lg.resume.session') }}</span>
              <div class="ah-resume-session" data-testid="resume-session">
                <AgentIcon :adapter="resume.session.value?.adapter ?? ''" :size="16" />
                <span class="ah-resume-title">
                  {{ resume.session.value?.title || resume.session.value?.cli_session_id || '—' }}
                </span>
                <span class="ah-resume-id ah-mono">
                  {{ resume.session.value?.cli_session_id || '—' }}
                </span>
              </div>
            </div>

            <div class="ah-env-row">
              <label class="ah-env-label" for="resume-env">{{ t('hub.launch.env') }}</label>
              <select
                id="resume-env"
                v-model="resume.form.environment"
                class="ah-input"
                data-testid="resume-env"
              >
                <option v-for="opt in environmentOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div class="ah-env-row">
              <label class="ah-env-label" for="resume-dir">{{ t('hub.launch.workingDir') }}</label>
              <div class="ah-resume-dir">
                <input
                  id="resume-dir"
                  v-model="resume.form.workingDir"
                  class="ah-input"
                  type="text"
                  :placeholder="t('hub.launch.workingDirPh')"
                  data-testid="resume-working-dir"
                />
                <button
                  type="button"
                  class="ah-btn ah-btn-ghost ah-btn-sm"
                  data-testid="resume-browse"
                  @click="resume.browseDir()"
                >
                  {{ t('hub.launch.browse') }}
                </button>
              </div>
            </div>

            <div class="ah-env-row">
              <label class="ah-env-label" for="resume-cmd">{{ t('hub.launch.command') }}</label>
              <input
                id="resume-cmd"
                v-model="resume.form.command"
                class="ah-input ah-mono"
                type="text"
                :disabled="resume.loading.value"
                data-testid="resume-command"
              />
            </div>

            <div v-if="resume.loading.value" class="ah-resume-hint" data-testid="resume-loading">
              {{ t('hub.lg.resume.loading') }}
            </div>
            <div v-if="resume.error.value" class="ah-cli-error" data-testid="resume-error">
              {{ resume.error.value }}
            </div>
          </div>

          <div class="ah-modal-foot">
            <button
              type="button"
              class="ah-btn ah-btn-ghost"
              data-testid="resume-cancel"
              @click="resume.close()"
            >
              {{ t('hub.launch.cancel') }}
            </button>
            <button
              type="button"
              class="ah-btn ah-btn-primary"
              :disabled="resume.loading.value || resume.submitting.value"
              data-testid="resume-confirm"
              @click="onConfirm"
            >
              {{ resume.submitting.value ? t('hub.launch.starting') : t('hub.lg.resume.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ah-resume-dir {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.ah-resume-dir .ah-input {
  flex: 1;
}
.ah-resume-session {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.ah-resume-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
.ah-resume-id {
  flex: none;
  color: var(--ah-text-data);
}
.ah-resume-hint {
  font-size: var(--font-size-tag);
  color: var(--ah-text-data);
}
</style>

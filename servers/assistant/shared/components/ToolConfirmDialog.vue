<script setup lang="ts">
/**
 * 工具确认卡（共享组件，双端同构 · 票 13 / spec §5.9）
 *
 * `write` 一次确认；`danger` 两次——第二次把影响范围摊开（`stage === 2`）。
 * 组件只发 approve / reject，不自己决定档位；档位与急停归工具运行时。
 */
import type { ToolConfirmRequest } from '@nest-shared/tools/types'

defineProps<{
  request: ToolConfirmRequest | null
  t: (key: string) => string
}>()

const emit = defineEmits<{ approve: []; reject: [] }>()
</script>

<template>
  <div
    v-if="request"
    class="nest-confirm"
    data-testid="nest-tool-confirm"
    :data-stage="request.stage"
  >
    <div class="nest-confirm__card">
      <h3 class="nest-confirm__title">
        <template v-if="request.stage === 2">
          {{ t('assistant.tools.confirm.dangerTitle') }}
        </template>
        <template v-else>{{ t('assistant.tools.confirm.title') }}</template>
      </h3>

      <dl class="nest-confirm__meta">
        <div class="nest-confirm__row">
          <dt>{{ t('assistant.tools.confirm.tool') }}</dt>
          <dd>{{ request.label }}（{{ request.toolId }}）</dd>
        </div>
        <div v-if="request.appId" class="nest-confirm__row">
          <dt>{{ t('assistant.tools.confirm.app') }}</dt>
          <dd>{{ request.appId }}</dd>
        </div>
        <div class="nest-confirm__row">
          <dt>{{ t('assistant.tools.confirm.risk') }}</dt>
          <dd>
            {{ t(`assistant.tools.risk.${request.risk}`) }}
            <span v-if="request.risk !== request.declaredRisk" class="nest-confirm__raised">
              {{ t('assistant.tools.confirm.raised') }}
            </span>
          </dd>
        </div>
        <div class="nest-confirm__row">
          <dt>{{ t('assistant.tools.confirm.args') }}</dt>
          <dd class="nest-confirm__digest">{{ request.argsDigest ?? '—' }}</dd>
        </div>
      </dl>

      <p v-if="request.stage === 2" class="nest-confirm__impact" data-testid="nest-tool-impact">
        {{ request.impact }}
      </p>

      <div class="nest-confirm__actions">
        <button
          type="button"
          class="nest-confirm__reject"
          data-testid="nest-tool-reject"
          @click="emit('reject')"
        >
          {{
            request.stage === 2
              ? t('assistant.tools.confirm.cancel')
              : t('assistant.tools.confirm.reject')
          }}
        </button>
        <button
          type="button"
          class="nest-confirm__approve"
          data-testid="nest-tool-approve"
          @click="emit('approve')"
        >
          {{
            request.stage === 2
              ? t('assistant.tools.confirm.confirmDanger')
              : t('assistant.tools.confirm.approve')
          }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nest-confirm {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.nest-confirm__card {
  width: min(420px, calc(100vw - 32px));
  background: var(--nest-surface, #232833);
  color: var(--nest-text, #e8eaf0);
  border: 1px solid var(--nest-border, #3a4150);
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}

.nest-confirm__title {
  margin: 0 0 12px;
  font-size: 15px;
}

.nest-confirm__meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.nest-confirm__row {
  display: flex;
  gap: 8px;
}

.nest-confirm__row dt {
  min-width: 64px;
  color: var(--nest-muted, #8a8f98);
}

.nest-confirm__row dd {
  margin: 0;
  word-break: break-all;
}

.nest-confirm__raised {
  margin-left: 6px;
  color: var(--nest-warn, #d8a657);
}

.nest-confirm__digest {
  font-family: ui-monospace, monospace;
}

.nest-confirm__impact {
  margin: 12px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--nest-error-bg, #3a2426);
  border: 1px solid var(--nest-error, #c0392b);
  color: var(--nest-error-text, #f0b4ae);
  font-size: 13px;
  line-height: 1.6;
}

.nest-confirm__actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.nest-confirm__reject,
.nest-confirm__approve {
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--nest-border, #3a4150);
  background: transparent;
  color: var(--nest-text, #e8eaf0);
}

.nest-confirm__approve {
  border-color: var(--nest-accent, #4f7cff);
  background: var(--nest-accent, #4f7cff);
  color: #fff;
}

.nest-confirm__approve:hover {
  filter: brightness(1.08);
}
</style>

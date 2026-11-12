<script setup lang="ts">
/**
 * 认证中心主界面（桌面服务型 wasm）
 *
 * 本版本是**就位状态 + 认证方式 + 接入应用 + 入场密钥代次**：密钥代次接真实
 * 命令（`auth-center.*`），接入应用清单是声明（`consumers.ts`）+ 宿主
 * `plugin_list_loaded` 运行态。配对码 / 二维码、可信设备、连接历史**不设页面**：
 * 命令与互调 api 面原样保留，由 BedCode 设备中心等消费方经互调取用。
 *
 * **注册已接管**（issue #6 切换）：本插件在 activate 末尾注册为认证中心，
 * `/api/auth/*` 也由本插件登记；BedCode 已同批去注册。就位状态卡按真实三态呈现——
 * 已就位 / 确知未就位（带原因）/ 读不到，不用固定文案冒充状态。
 *
 * 失败语义（issue #6 D3）：读不到就落 `unknown` 三态 + 原因，保留重试；不把
 * 「命令失败」当成「未就位」。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { AuthCenterContext } from '../appContext'
import type { CenterState, CenterStatus } from '../types'
import ConsumersCard from './ConsumersCard.vue'
import KeyCard from './KeyCard.vue'

const context = inject<AuthCenterContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

/** 命令面：本 app 插件命令（宿主按 manifest 声明的 id 路由） */
const STATUS_COMMAND = 'auth-center.status'

const status = ref<CenterStatus | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

/** 三态归一：没有可判读的响应 ⇒ `unknown`（不猜成 not_ready） */
const state = computed<CenterState>(() => {
  const raw = status.value?.state
  if (raw === 'registered' || raw === 'not_ready') return raw
  return 'unknown'
})

const stateLabel = computed(() => t(`status.${state.value}`))

/** 缺失字段一律 `—`（不是 0 / 空串） */
const reasonText = computed(() => status.value?.reason || t('status.none'))
const ownerText = computed(() => status.value?.owner || t('status.none'))
const versionText = computed(() => status.value?.version || t('status.none'))

/** 声明的方式：后端没给就是「没声明」，不用空列表伪装成「没有可用方式」 */
const methods = computed(() => status.value?.methods ?? [])

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const payload = await context.appInvoke<CenterStatus>(STATUS_COMMAND)
    if (!payload || typeof payload !== 'object' || typeof payload.state !== 'string') {
      throw new Error('unexpected payload from auth-center.status')
    }
    status.value = payload
  } catch (e) {
    // 失败保留上一次成功数据（若存在）并把原因上屏，不清成空表
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="ac-page" data-testid="auth-center-page">
    <header class="ac-topbar">
      <div class="ac-wrap ac-topbar-inner">
        <span class="ac-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M12 4.6l5.4 2.1v4.2c0 3.2-2.2 5.7-5.4 7.3-3.2-1.6-5.4-4.1-5.4-7.3V6.7z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
            <circle cx="12" cy="10.6" r="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
            <path d="M12 12.1v2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </span>
        <div class="ac-heading">
          <h1 class="ac-title">{{ t('title') }}</h1>
          <p class="ac-sub">{{ t('subtitle') }}</p>
        </div>
      </div>
    </header>

    <main class="ac-wrap ac-main">
      <section class="ac-card" data-testid="auth-center-status">
        <div class="ac-card-head">
          <h2 class="ac-h2">{{ t('status.title') }}</h2>
          <button class="ac-btn" :disabled="loading" data-testid="auth-center-refresh" @click="load">
            {{ loading ? t('loading') : t('refresh') }}
          </button>
        </div>

        <p v-if="loading && !status" class="ac-hint" data-testid="auth-center-loading">
          {{ t('loading') }}
        </p>

        <template v-else>
          <p class="ac-state" :class="`is-${state}`" data-testid="auth-center-state" :data-state="state">
            <span class="ac-dot" aria-hidden="true"></span>
            <span>{{ stateLabel }}</span>
          </p>

          <dl class="ac-meta">
            <div>
              <dt>{{ t('status.reason') }}</dt>
              <dd data-testid="auth-center-reason">{{ reasonText }}</dd>
            </div>
            <div>
              <dt>{{ t('status.owner') }}</dt>
              <dd data-testid="auth-center-owner">{{ ownerText }}</dd>
            </div>
            <div>
              <dt>{{ t('status.version') }}</dt>
              <dd data-testid="auth-center-version">{{ versionText }}</dd>
            </div>
          </dl>

          <p v-if="error" class="ac-error" role="alert" data-testid="auth-center-error">
            {{ t('error.body', { message: error }) }}
            <button class="ac-linkbtn" data-testid="auth-center-retry" @click="load">
              {{ t('retry') }}
            </button>
          </p>
        </template>
      </section>

      <section class="ac-card" data-testid="auth-center-methods">
        <h2 class="ac-h2">{{ t('methods.title') }}</h2>
        <ul v-if="methods.length > 0" class="ac-methods">
          <li
            v-for="method in methods"
            :key="method.id"
            class="ac-method"
            :class="{ 'is-off': !method.available }"
            :data-testid="`auth-center-method-${method.id}`"
            :data-available="method.available ? 'yes' : 'no'"
          >
            <span class="ac-method-name">{{ t(`methods.${method.id}`) }}</span>
            <span class="ac-tag">{{ t(method.available ? 'methods.available' : 'methods.unavailable') }}</span>
          </li>
        </ul>
        <p v-else class="ac-hint" data-testid="auth-center-methods-empty">{{ t('status.none') }}</p>
      </section>

      <ConsumersCard />
      <KeyCard />
    </main>
  </div>
</template>

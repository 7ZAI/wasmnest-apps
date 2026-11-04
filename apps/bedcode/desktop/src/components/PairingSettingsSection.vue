<template>
  <!-- 分组正文：外层 <section> 与标题由宿主统一渲染（settings section 扩展点约定） -->
  <div
    class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] divide-y divide-[var(--border)]"
  >
    <!-- 二维码有效期 -->
    <div class="px-5 py-3.5 flex items-center justify-between gap-4">
      <div>
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('pairing.settings.qrValidity')
        }}</span>
      </div>
      <NumberField
        v-model="qrTokenTtl"
        :min="TTL_MIN"
        :max="TTL_MAX"
        :aria-label="t('pairing.settings.qrValidity')"
        width="112px"
        data-testid="pairing-qr-ttl"
        @commit="saveQrTokenTtl"
      />
    </div>

    <!-- 配对码有效期 -->
    <div class="px-5 py-3.5 flex items-center justify-between gap-4">
      <div>
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('pairing.settings.pairingCodeTtl')
        }}</span>
      </div>
      <NumberField
        v-model="pairingCodeTtl"
        :min="TTL_MIN"
        :max="TTL_MAX"
        :aria-label="t('pairing.settings.pairingCodeTtl')"
        width="112px"
        data-testid="pairing-code-ttl"
        @commit="savePairingCodeTtl"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * PairingSettingsSection — 设置页「配对设置」分组正文（宿主 `SettingsPairingSection.vue`
 * 的插件版，票 14）
 *
 * 两层配置口径（spec D6）：需要交互控件的项走组件式分组（本组件），标量声明式项走
 * 插件 `configSchema`；本分组承载「二维码有效期 / 配对码有效期」两项。
 *
 * 校验不降级（spec D6 末条）：此处只做 UX 侧范围收敛（60-3600），最终仲裁在宿主
 * `auth-setting-set` 原语（键白名单 + 正整数校验）；写入经插件命令通道到 WASM，
 * 再经宿主原语权限门。
 *
 * 宿主原「默认端口」项不在本分组：端口属宿主服务器引擎配置（ADR 0022 裁剪线——
 * 认证域设置项之外的宿主引擎设置），插件无写入原语，该项由宿主设置页系统分组承载。
 */
import { inject, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import NumberField from '@binblink/wasmnest-plugin-sdk-desktop/ui/number-field'

const context = inject<PluginContext>('pluginContext')!
const { t } = context.i18n

/** TTL 范围（与宿主 `validate_qr_token_ttl` 同界：60s - 3600s） */
const TTL_MIN = 60
const TTL_MAX = 3600

const qrTokenTtl = ref(300)
const pairingCodeTtl = ref(60)

async function loadTtls() {
  const info = (await context.commands.execute('session.settings.ttl.get', {})) as
    { qrTokenTtl: number; pairingCodeTtl: number } | undefined
  if (!info) return
  if (typeof info.qrTokenTtl === 'number') qrTokenTtl.value = info.qrTokenTtl
  if (typeof info.pairingCodeTtl === 'number') pairingCodeTtl.value = info.pairingCodeTtl
}

/**
 * 写入一项 TTL。
 *
 * `committed` 由 `NumberField` 的 `commit` 给出，已是按 [TTL_MIN, TTL_MAX] 钳制并取整过
 * 的值；这里再做一次同口径收敛只是防御（写入面最终仲裁仍在宿主 `auth-setting-set`），
 * 保证「提交值 / 回显值」始终同源。
 */
async function saveTtl(key: 'qrTokenTtl' | 'pairingCodeTtl', committed: number): Promise<void> {
  const value = Math.max(TTL_MIN, Math.min(TTL_MAX, Math.round(committed)))
  if (key === 'qrTokenTtl') {
    qrTokenTtl.value = value
  } else {
    pairingCodeTtl.value = value
  }
  try {
    await context.commands.execute('session.settings.ttl.set', { key, value })
    toast.success(t('pairing.settings.saved'))
  } catch (e) {
    console.error('[Device Center] save pairing settings failed:', e)
    toast.error(t('pairing.settings.saveFailed'))
  }
}

function saveQrTokenTtl(value: number) {
  void saveTtl('qrTokenTtl', value)
}

function savePairingCodeTtl(value: number) {
  void saveTtl('pairingCodeTtl', value)
}

onMounted(async () => {
  try {
    await loadTtls()
  } catch (e) {
    console.error('[Device Center] load pairing settings failed:', e)
    toast.error(t('pairing.settings.saveFailed'))
  }
})
</script>

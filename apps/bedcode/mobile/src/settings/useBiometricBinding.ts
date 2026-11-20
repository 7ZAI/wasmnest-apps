/**
 * 生物凭证绑定编排（设置域）
 *
 * 补齐「绑定生物认证信息」的闭环：连接页的生物认证只负责**用**已绑定的凭证登录，
 * 而凭证的**绑定 / 解绑**入口此前缺失（useHostPage 暴露了 bind/unbind 包装却无 UI 调用，
 * 文案「请先在认证设置中绑定生物认证」指向一个不存在的入口）。本 composable 把绑定面
 * 落到设置页认证分组。
 *
 * 数据面全部走宿主生物凭证引擎面（mobileApi，C4 凭据零过境）：本域只投状态与触发动作，
 * 密钥对生成 / Keystore 保管 / 公钥注册到桌面端全在宿主，插件不接触任何私钥或 token。
 *
 * 闸门：绑定 / 解绑都要求**已认证连接**（宿主持有可用 JWT，api.isPaired）——公钥要经
 * 已认证 HTTP 注册到桌面端，未认证时宿主会拒绝。设备不支持生物识别时只读状态、不给动作。
 *
 * 失败口径：状态探测失败置空（隐藏动作，不阻断设置页）但落 warn；绑定 / 解绑失败上抛，
 * 由 UI 弹错误提示——不假装成功。
 */
import { computed, inject, ref } from 'vue'
import type { MobileHostApi, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'

/** 生物凭证状态（形状取自 SDK 引擎面返回值，避免依赖未导出的具名类型） */
export type BiometricKeyStatus = Awaited<ReturnType<MobileHostApi['getBiometricKeyStatus']>>

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useBiometricBinding(provided?: PluginContext) {
  const context = provided ?? inject<PluginContext>('pluginContext')
  if (!context) throw new Error('[settings] pluginContext not provided')
  const ctx = context
  const api = getMobileApi()
  const logger = ctx.logger

  /** 最近一次状态快照；null = 尚未读取或探测失败（UI 据此隐藏动作） */
  const status = ref<BiometricKeyStatus | null>(null)
  /** 绑定 / 解绑进行中（禁用交互，防重复触发） */
  const busy = ref(false)

  const deviceSupported = computed(() => !!status.value?.deviceSupported)
  const hasKey = computed(() => !!status.value?.hasKey)
  /** 已认证连接（宿主持有可用 JWT）——绑定 / 解绑的前置闸门 */
  const isPaired = api.isPaired
  /** 可执行绑定：设备支持 + 已认证 + 尚未绑定 + 不在忙 */
  const canBind = computed(
    () => deviceSupported.value && isPaired.value && !hasKey.value && !busy.value,
  )
  /** 可执行解绑：已绑定 + 已认证 + 不在忙 */
  const canUnbind = computed(() => hasKey.value && isPaired.value && !busy.value)

  /** 刷新状态（只读；失败置空并落 warn，不阻断设置页） */
  async function refresh(): Promise<void> {
    try {
      status.value = await api.getBiometricKeyStatus()
    } catch (e) {
      status.value = null
      logger.warn(`[settings] biometric status probe failed: ${errText(e)}`)
    }
  }

  /** 绑定：宿主生成密钥对 + 生物自检 + 注册公钥到桌面端；成功后刷新状态 */
  async function bind(): Promise<boolean> {
    busy.value = true
    try {
      const ok = await api.bindBiometricCredential()
      if (!ok) logger.warn('[settings] bind biometric credential rejected')
      await refresh()
      return ok
    } catch (e) {
      logger.error(`[settings] bind biometric failed: ${errText(e)}`)
      throw e
    } finally {
      busy.value = false
    }
  }

  /** 解绑：宿主通知桌面端清空公钥 + 删除本地密钥；成功后刷新状态 */
  async function unbind(): Promise<boolean> {
    busy.value = true
    try {
      const ok = await api.unbindBiometricCredential()
      if (!ok) logger.warn('[settings] unbind biometric credential rejected')
      await refresh()
      return ok
    } catch (e) {
      logger.error(`[settings] unbind biometric failed: ${errText(e)}`)
      throw e
    } finally {
      busy.value = false
    }
  }

  return {
    status,
    busy,
    deviceSupported,
    hasKey,
    isPaired,
    canBind,
    canUnbind,
    refresh,
    bind,
    unbind,
  }
}

/**
 * 宿主机制文案副本（app 独立挂载包自足）
 *
 * 错误信封（ADR 0030）的 `errors.<code>` 是宿主机制契约：code 即 i18n key，
 * app 的 userError / pluginError 消费侧按同一命名空间查文案。app 是独立挂载包，
 * 不共享宿主 i18n 实例，故在此自持一份。
 *
 * 键名与宿主 `wasmnest-desktop/src/i18n/host-*.ts` 的 `errors` 块一致，只取
 * app 可见面（`host.*` / `frontend.*` + 重试按钮文案）；宿主壳专属的
 * `errors.shell.*` 不在此列。业务文案一律走 app 域命名空间（见 zh-CN / en）。
 */

/** zh-CN 机制文案 */
export const mechanismZhCN = {
  errors: {
    retry: '重试',
    host: {
      internal: '操作未完成，请稍后重试',
      invoke: {
        timeout: '操作超时，请重试',
      },
      plugin: {
        'not-activated': '该应用未启用，无法执行此操作',
        'not-found': '应用不存在或已卸载',
        trap: '应用「{name}」运行异常，已尝试自动恢复',
        'recovery-failed': '应用「{name}」运行异常且未能自动恢复，请到应用中心处理',
        'self-check-failed': '应用「{plugin}」启动自检失败，请检查配置',
        degraded: '应用「{name}」降级运行，部分功能不可用',
      },
    },
    frontend: {
      internal: '操作未完成，请稍后重试',
    },
  },
}

/** en 机制文案 */
export const mechanismEn = {
  errors: {
    retry: 'Retry',
    host: {
      internal: 'Operation failed, please try again',
      invoke: {
        timeout: 'Operation timed out, please retry',
      },
      plugin: {
        'not-activated': 'This app is not enabled, this action is unavailable',
        'not-found': 'App not found or removed',
        trap: 'App "{name}" misbehaved, auto-recovery attempted',
        'recovery-failed': 'App "{name}" failed and could not recover; check the app center',
        'self-check-failed': 'App "{plugin}" self-check failed, check its configuration',
        degraded: 'App "{name}" is running degraded, some features unavailable',
      },
    },
    frontend: {
      internal: 'Operation failed, please try again',
    },
  },
}

/**
 * Monitor app 页面对象（桌面 E2E）
 *
 * 隔离插件目录里只有 monitor 一个 app，因此快照里至少包含本应用自身的指标；
 * 断言只依赖这个事实与本应用的 testid，不依赖本机其他 app 的装机状态。
 */

/** 应用显示名（= monitor/desktop/plugin.json `name`） */
export const APP_NAME = 'Monitor'

/** 插件 id（= 产物目录名 / 快照 plugins 键） */
export const MONITOR_PLUGIN_ID = 'com.wasmnest.monitor'

/** 本应用在快照里的插件卡 */
export const SELF_CARD = `monitor-plugin-${MONITOR_PLUGIN_ID}`
export const SELF_QUOTA_TOGGLE = `monitor-quota-toggle-${MONITOR_PLUGIN_ID}`
export const SELF_QUOTA_NOTE = `monitor-quota-note-${MONITOR_PLUGIN_ID}`

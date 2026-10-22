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

/** 角色过滤（全部 / 服务 / 应用） */
export const FILTER_ALL = 'monitor-filter-all'
export const FILTER_SERVICES = 'monitor-filter-services'
export const FILTER_APPS = 'monitor-filter-apps'

/** 本应用的角色徽标（manifest kind = internal-business，E2E 验证服务角色端到端生效） */
export const SELF_ROLE = `monitor-role-${MONITOR_PLUGIN_ID}`

/** 页头整页页签条（只有其他应用注册监控面板时才出现） */
export const PAGE_TABS = 'monitor-page-tabs'

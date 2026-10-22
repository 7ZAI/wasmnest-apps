/**
 * 系统页「应用管理」页面对象（桌面 E2E）
 *
 * 隔离插件目录里只有 monitor 一个应用，且它是系统服务（`internal-business`）——
 * 这正好是「系统服务区」的最小可判定现场：服务区在场、应用区不渲染空标题。
 */

/** 壳路由（平台 `src/router/index.ts`：'/sys/:pageId'） */
export const SYS_APPS_ROUTE = '/sys/apps'

export const GROUP_SERVICES = 'sys-apps-group-services'
export const GROUP_APPS = 'sys-apps-group-apps'

/** 服务卡片显示名（= monitor/desktop/plugin.json `name`） */
export const SERVICE_APP_NAME = 'Monitor'

/** 卸载按钮文案（宿主 i18n 中英）——系统服务不得出现任一形态 */
export const UNINSTALL_TEXTS = ['卸载', 'Uninstall']

import type { MessageSchema } from './messages'

/**
 * 中文翻译
 *
 * 独立文件维护，构建期由 Vite 打包内联进 bundle，无运行时文件读取。
 */
const zhCN: MessageSchema = {
  navTitle: 'AI',
  settingsTitle: '设置',
  configuredProviders: '已配置的供应商',
  expandProviders: '展开已配置的供应商',
  collapseProviders: '收起已配置的供应商',
  noConfiguredProviders: '暂无已配置的供应商',
}

export default zhCN

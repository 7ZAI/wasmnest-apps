/**
 * Agent Hub 前端旧 lib 入口 —— 退役为 dev-shell 兼容出口
 *
 * 桌面 UI 宿主修正（2026-10-17）：app 前端是**独立挂载包**（入口 = src/entry.ts
 * 的 mountApp 契约，宿主 useAppMount 装载），lib 形态的 activate(context) /
 * registerSidebarPanel 贡献面整面退役。
 *
 * 本文件保留的唯一职责：SDK dev-shell（wasmnest-plugin-desktop dev）按旧协议
 * 读 `devMock` 出口做浏览器预览。主宿主不再 import 本文件（vite 入口 = entry.ts）。
 */
import hubDevMock from './devMock'

// dev-shell 领域种子数据（SDK PluginDevMock 协议；真实宿主忽略）
export const devMock = hubDevMock

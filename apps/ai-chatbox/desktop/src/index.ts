/**
 * AI Chatbox 前端旧 lib 入口 —— 退役为 dev-shell 兼容出口
 *
 * 桌面 UI 宿主修正（2026-10-17）：app 前端是**独立挂载包**（入口 = src/entry.ts
 * 的 mountApp 契约，宿主 useAppMount 装载），lib 形态的 activate(context) /
 * 贡献面注册整面退役。本文件只保留 dev-shell（wasmnest-plugin-desktop dev）
 * 的入口形态（无导出亦可，主宿主不再 import 本文件）。
 */
export {}

/**
 * Lanbitou 前端 dev-shell 兼容出口
 *
 * 桌面 UI 宿主修正（ADR 0057）：app 前端是**独立挂载包**（入口 = src/entry.ts
 * 的 mountApp 契约，宿主 useAppMount 装载）。主宿主不加载本文件；当前
 * Lanbitou 没有 dev-shell 专用 mock，保留空导出仅维持入口形态一致。
 */
export {}

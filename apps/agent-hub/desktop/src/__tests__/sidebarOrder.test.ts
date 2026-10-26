/**
 * 侧边栏贡献面退役锁（桌面 UI 宿主修正 2026-10-17 改写）
 *
 * 旧契约：`registerSidebarPanel({ order })` + manifest `contributes.views` 双源
 * 同序（O1/O2）。桌面 UI 宿主修正后 app 前端是**独立挂载包**（mountApp 契约），
 * 侧边栏贡献面随旧插件呈现机制整面退役——本锁改钉退役面：
 * - R1 前端入口（entry.ts）零 `registerSidebarPanel` 回接；
 * - R2 manifest 不再声明 `contributes.views`（呈现面归宿主路由目录静态表）；
 * - R3 主屏应用卡落地路由 = 宿主路由表前缀（/hub）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// vitest 以 app 工程根为 cwd
const PLUGIN_ROOT = resolve(process.cwd())
const manifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'plugin.json'), 'utf-8'))

describe('侧边栏贡献面退役锁', () => {
  it('manifest 不再声明 contributes.views（呈现面归宿主静态路由目录）', () => {
    expect(manifest.contributes?.views, '旧贡献面已退役，不得再声明').toBeUndefined()
  })

  it('前端入口零 registerSidebarPanel 回接（只约束可执行代码，注释说明不判）', () => {
    for (const f of ['src/entry.ts', 'src/appContext.ts']) {
      const code = readFileSync(resolve(PLUGIN_ROOT, f), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code).not.toContain('registerSidebarPanel')
    }
  })

  it('entry.ts 导出 mountApp 挂载契约（宿主 useAppMount 装载）', () => {
    const entry = readFileSync(resolve(PLUGIN_ROOT, 'src/entry.ts'), 'utf-8')
    expect(entry).toContain('export async function mountApp(')
    expect(entry).toContain('app.mount(root)')
  })
})

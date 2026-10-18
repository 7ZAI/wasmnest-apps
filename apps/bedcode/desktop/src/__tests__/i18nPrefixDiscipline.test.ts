/**
 * i18n 命名空间纪律锁（2026-09-26 立；桌面宿主前端下沉后改判据）
 *
 * 旧判据（下沉前）：插件消息经 `context.i18n.registerMessages` **运行期自动加插件
 * ID 前缀**，插件组件若直接用 `useI18n()` 会在宿主命名空间下查无此 key → 回显
 * key 原文。故锁「插件前端不得直接 import vue-i18n」。
 *
 * 新判据（下沉后，D5「消息 key 自带 com.wasmnest.terminal-session.* 命名空间 +
 * 薄取文案函数」）：app 自持唯一 i18n 实例，宿主机制组件经 `useI18n()` 查顶层
 * key、app 域经直连上下文的薄 t() 自动补命名空间——两种形态都合法。锁的对象
 * 从「import 纪律」改为「命名空间纪律」：
 *   L1 无运行期前缀机制（registerMessages / mergeLocaleMessage / 手拼
 *      `${id}.${key}` 前缀全部退役，不得回接）；
 *   L2 薄 t() 必须经 MESSAGE_NAMESPACE 补前缀（防改直传导致 key 原文）；
 *   L3 静态表（侧边栏 / 设置分组）的 app 域 key 必须带命名空间、宿主机制项
 *      必须不带（两种命名域不得混用）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** app 前端源码根（vitest 以 app 工程根为 cwd——独立 vitest.config.ts） */
const APP_SRC = join('src')

/** 运行期前缀机制 needle（旧 context.i18n 的自动前缀三件 + 手拼前缀形态） */
const RUNTIME_PREFIX_NEEDLES: { name: string; pattern: RegExp }[] = [
  { name: 'registerMessages（运行期注册消息）', pattern: /registerMessages/ },
  { name: 'mergeLocaleMessage（运行期合并消息）', pattern: /mergeLocaleMessage/ },
  { name: '手拼插件 ID 前缀', pattern: /\$\{(?:info|context|props\.plugin|pluginId)\.id\}/ },
]

/**
 * 剔除注释后的代码正文：判据只约束**可执行代码**——注释里说明「旧机制已退役」
 * 的设计背景是合法文档（AGENTS.md §6 允许以引用补充说明），不算回接。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 递归收集 app 前端源码（排除测试目录；判据只面向 .ts / .vue 交付源码） */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('i18n 命名空间纪律锁', () => {
  it('正例：运行期前缀 needle 的判定函数认得旧机制形态', () => {
    const needles = RUNTIME_PREFIX_NEEDLES
    expect(needles[0].pattern.test(`context.i18n.registerMessages(locale, msgs)`)).toBe(true)
    expect(needles[1].pattern.test(`hostI18n.global.mergeLocaleMessage(locale, prefixed)`)).toBe(true)
    expect(needles[2].pattern.test('const fullKey = `${info.id}.${key}`')).toBe(true)
  })

  it('反例：命名空间常量与静态表 key 不算运行期前缀', () => {
    const needles = RUNTIME_PREFIX_NEEDLES
    expect(needles[0].pattern.test(`i18n.global.t(\`\${MESSAGE_NAMESPACE}.\${key}\`)`)).toBe(false)
    expect(needles[2].pattern.test(`labelKey: \`\${MESSAGE_NAMESPACE}.pairing.sidebar.title\``)).toBe(false)
  })

  it('L1 集成：app 前端源码零运行期前缀机制（回接即红）', () => {
    const files = collectSourceFiles(APP_SRC)
    // 防「扫描空转 = 全绿」：真实扫到了交付源码
    expect(files.length).toBeGreaterThanOrEqual(30)

    for (const needle of RUNTIME_PREFIX_NEEDLES) {
      const offenders = files.filter((file) =>
        needle.pattern.test(stripComments(readFileSync(file, 'utf-8'))),
      )
      expect(
        offenders,
        `运行期前缀机制已退役，出现即为回接：${needle.name} → ${offenders.join(', ')}`,
      ).toEqual([])
    }
  })

  it('L2 薄 t() 经 MESSAGE_NAMESPACE 补前缀（appContext 单点）', () => {
    const appContext = readFileSync(join(APP_SRC, 'appContext.ts'), 'utf-8')
    // 薄 t 的内部实现必须拼命名空间（防改直传 → app 域 key 原文上界面）
    expect(appContext).toMatch(/i18n\.global\.t\(`\$\{MESSAGE_NAMESPACE\}\.\$\{key\}`/)
    // 且 MESSAGE_NAMESPACE 的值就是插件 ID（与 manifest.id 同源）
    const i18nIndex = readFileSync(join(APP_SRC, 'i18n', 'index.ts'), 'utf-8')
    expect(i18nIndex).toContain("export const MESSAGE_NAMESPACE = 'com.wasmnest.terminal-session'")
  })

  it('L3 静态表两种命名域不混用（app 域带前缀 / 宿主机制项不带）', () => {
    const menu = readFileSync(join(APP_SRC, 'composables', 'useSidebarMenu.ts'), 'utf-8')
    // app 域菜单项：经 MESSAGE_NAMESPACE 模板拼装
    expect(menu).toContain('labelKey: `${MESSAGE_NAMESPACE}.pairing.sidebar.title`')
    expect(menu).toContain('labelKey: `${MESSAGE_NAMESPACE}.session.sidebar.title`')
    // 宿主机制项（设置）：顶层 key 直写
    expect(menu).toContain("labelKey: 'desktop.sidebar.settings'")
  })
})

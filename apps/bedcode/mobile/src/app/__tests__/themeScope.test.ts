/**
 * 主题隔离锁（移动端）——宿主主题预设不命中 bedcode
 *
 * 口径（用户 2026-11-06 裁决，方案 2）：
 *   · 内置主题预设（glass / hyper）的 token 与结构规则**不得**作用到应用；
 *   · 应用仍跟随宿主深浅色（html:not(.dark)）与主色色板（[data-palette]，本层不声明 accent）。
 *
 * 被测真源：`src/app/themeScope.css`（作用域 = [data-bedcode-surface]）。
 * 比对真源：平台仓 `wasmnest-mobile/src/styles/{mobile.css,theme-presets.css}`
 * （经 `WASMNEST_PLATFORM_ROOT` 解析；CI 的 needsPlatform 判据即读这个环境变量）。
 *
 * | 锁 | 规则 | 预期 |
 * |---|---|---|
 * | T-S1 | 默认档快照一致 | 宿主默认 token 值（深 / 浅）与应用重置值逐 token 相等 |
 * | T-S2 | 预设立场覆盖 | 宿主主题预设重写的每个基础 token（玻璃材质 token 除外）都被应用重置 |
 * | T-S3 | 结构规则中和 | .group-card 的玻璃材质 / 硬边规则与伪元素被应用作用域还原 |
 * | T-S4 | 宿主类词表不渗入 | 应用源码不使用宿主主题结构规则命中的类名（group-card / mobile-ui 除外） |
 * | T-S5 | 作用域锚点完整 | 每个 Teleport 根都带 data-bedcode-surface（body 挂载面同规则） |
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const APP_ROOT = resolve(__dirname, '../../..')
const PLATFORM_ROOT =
  process.env.WASMNEST_PLATFORM_ROOT ?? resolve(APP_ROOT, '../../../../wasmnest')
const HOST_STYLES = join(PLATFORM_ROOT, 'wasmnest-mobile/src/styles')

const hostMobileCss = readFileSync(join(HOST_STYLES, 'mobile.css'), 'utf8')
const hostPresetCss = readFileSync(join(HOST_STYLES, 'theme-presets.css'), 'utf8')
const appScopeCss = readFileSync(join(APP_ROOT, 'src/app/themeScope.css'), 'utf8')

interface CssRule {
  selector: string
  body: string
}

/** 抽出文件的全部「选择器 { 声明块 }」（去注释；@media 内的规则以内部选择器参与） */
function rulesOf(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] })
  }
  return rules
}

/** 声明块里的自定义属性（值做空白归一 + 小写，hex 大小写不影响语义） */
function customProps(body: string): Map<string, string> {
  const props = new Map<string, string>()
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    props.set(match[1], normalizeValue(match[2]))
  }
  return props
}

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function ruleOf(css: string, selector: string): CssRule {
  const rule = rulesOf(css).find((item) => item.selector === selector)
  if (!rule) throw new Error(`未找到选择器块：${selector}`)
  return rule
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' || name === 'dist' ? [] : walk(path)
    }
    return [path]
  })
}

/** 宿主默认档（深色）与 `.theme-base`（主题专属 token 的默认档） */
const hostDark = customProps(ruleOf(hostMobileCss, ':root, .theme-base').body)
const hostLight = customProps(
  ruleOf(hostMobileCss, 'html:not(.dark), html:not(.dark) .theme-base').body,
)
const hostBaseTheme = customProps(ruleOf(hostMobileCss, '.theme-base').body)

const appDark = customProps(ruleOf(appScopeCss, '[data-bedcode-surface]').body)
const appLight = customProps(ruleOf(appScopeCss, 'html:not(.dark) [data-bedcode-surface]').body)

/** 主题预设重写的基础 token 集合 */
function presetTokens(): Set<string> {
  const tokens = new Set<string>()
  for (const rule of rulesOf(hostPresetCss)) {
    if (!/\[data-theme='(?:glass|hyper)'\]/.test(rule.selector)) continue
    for (const token of customProps(rule.body).keys()) tokens.add(token)
  }
  return tokens
}

/**
 * 玻璃材质 token（--theme-glass-*）不参与逐 token 重置：
 * 它们只被宿主主题的结构规则消费；应用侧命中的唯一结构规则（.group-card）已在
 * T-S3 整条还原（背景 / 边框 / 阴影 / 模糊 / 伪元素），不依赖这些 token 的取值。
 */
const MATERIAL_PREFIX = '--theme-glass-'

function defaultOf(token: string, mode: 'dark' | 'light'): string | undefined {
  const modeProps = mode === 'dark' ? hostDark : hostLight
  return modeProps.get(token) ?? hostBaseTheme.get(token) ?? hostDark.get(token)
}

describe('T-S1 默认档快照一致（逐 token 对齐宿主 mobile.css）', () => {
  it('should_matchHostDefaultValues_when_themePresetIsActive', () => {
    const tokens = [...presetTokens()].filter((token) => !token.startsWith(MATERIAL_PREFIX))
    expect(tokens.length).toBeGreaterThan(0)

    for (const token of tokens) {
      expect(appDark.get(token), `深色档缺少 ${token} 的重置`).toBeDefined()
      expect(appDark.get(token), `深色档 ${token} 与宿主默认值不一致`).toBe(
        defaultOf(token, 'dark'),
      )
      expect(appLight.get(token), `浅色档缺少 ${token} 的重置`).toBeDefined()
      expect(appLight.get(token), `浅色档 ${token} 与宿主默认值不一致`).toBe(
        defaultOf(token, 'light'),
      )
    }
  })

  it('should_keepHexCaseInsensitive_when_comparing', () => {
    // 宿主写 #15130F、应用写 #15130f：语义相同，锁不应因大小写误报
    expect(normalizeValue('#15130F')).toBe(normalizeValue('#15130f'))
  })
})

describe('T-S2 预设立场覆盖（宿主预增设新 token 时点名缺失）', () => {
  it('should_resetEveryPresetBaseToken_when_presetMutatesIt', () => {
    const missing = [...presetTokens()]
      .filter((token) => !token.startsWith(MATERIAL_PREFIX))
      .filter((token) => !appDark.has(token) || !appLight.has(token))

    expect(missing, `宿主主题预设新增了未隔离的 token：${missing.join(', ')}`).toEqual([])
  })
})

describe('T-S3 结构规则中和（分组卡还原默认形态）', () => {
  const structural = rulesOf(appScopeCss)

  it('should_restoreDefaultGroupCard_when_presetThemeActive', () => {
    const rule = structural.find(
      (item) =>
        item.selector.includes('[data-bedcode-surface] .group-card') &&
        !item.selector.includes('::'),
    )
    expect(rule, '缺少 .group-card 结构还原规则').toBeTruthy()

    for (const declaration of [
      'background: var(--mobile-group-bg)',
      'border: 1px solid var(--mobile-group-border)',
      'border-radius: 1rem',
      'box-shadow: none',
      '-webkit-backdrop-filter: none',
      'backdrop-filter: none',
    ]) {
      expect(rule!.body, `.group-card 还原缺少声明：${declaration}`).toContain(declaration)
    }
    // 选择器必须压过宿主预设的 0,3,0（:root[data-theme] + 作用域锚点 = 0,4,0）
    expect(rule!.selector).toContain(':root[data-theme]')
  })

  it('should_cancelPresetDecorations_when_groupCardRenders', () => {
    const pseudoRules = structural.filter((item) => item.selector.includes('.group-card::'))
    expect(pseudoRules.length).toBeGreaterThan(0)
    for (const rule of pseudoRules) {
      expect(rule.selector).toContain('[data-bedcode-surface]')
      expect(rule.body).toContain('content: none')
    }
  })

  it('should_paintOwnDefaultBackground_when_appSurfaceOpens', () => {
    const rule = structural.find((item) => item.selector === '.app-root[data-bedcode-surface]')
    expect(rule, '运行面根缺少默认底色').toBeTruthy()
    expect(rule!.body).toContain('background: var(--mobile-bg-primary)')
  })
})

describe('T-S4 宿主类词表不渗入（结构规则命中的类名不得出现在应用源码）', () => {
  /** 允许命中、且已在应用作用域内中和的宿主类 */
  const ALLOWED = new Set([
    'group-card', // 分组卡基础语汇：T-S3 中和材质 / 硬边规则
    'mobile-ui', // 弹层排版口径：themeScope 的 --theme-ambient: none 中和环境光背景
    'active', // 通用状态修饰符（宿主规则是 .theme-picker-btn.active 这类复合选择器，单独出现不命中）
  ])

  it('should_notUseHostPresetClasses_when_appSourceAuthored', () => {
    const presetClasses = new Set<string>()
    for (const rule of rulesOf(hostPresetCss)) {
      // 只看从 <html data-theme> 向下生效的结构规则；预览块（.theme-swatch）等在宿主内部
      if (!rule.selector.includes(':root[data-theme')) continue
      for (const match of rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) presetClasses.add(match[1])
    }
    expect(presetClasses.size).toBeGreaterThan(0)

    const sources = walk(join(APP_ROOT, 'src')).filter(
      (file) => /\.(vue|css|ts)$/.test(file) && !file.includes('__tests__'),
    )
    const hits: string[] = []
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      for (const className of presetClasses) {
        if (ALLOWED.has(className)) continue
        if (new RegExp(`(^|[^\\w-])${className}([^\\w-]|$)`).test(text)) {
          hits.push(`${relative(APP_ROOT, file)} → .${className}`)
        }
      }
    }

    expect(hits, `应用源码使用了宿主主题规则命中的类名：\n${hits.join('\n')}`).toEqual([])
  })
})

describe('T-S5 作用域锚点完整（Teleport / body 挂载面）', () => {
  it('should_markEveryTeleportRoot_when_mountedToBody', () => {
    const vueFiles = walk(join(APP_ROOT, 'src')).filter((file) => file.endsWith('.vue'))
    const offenders = vueFiles.filter((file) => {
      const text = readFileSync(file, 'utf8')
      const teleports = (text.match(/<Teleport\b/g) ?? []).length
      if (teleports === 0) return false
      const markers = (text.match(/data-bedcode-surface/g) ?? []).length
      return markers < teleports
    })

    expect(
      offenders.map((file) => relative(APP_ROOT, file)),
      '以下文件的 Teleport 根缺少 data-bedcode-surface（脱离运行面后会被主题预设污染）',
    ).toEqual([])
  })

  it('should_markAppRootAndImportScope_when_appSurfaceRegisters', () => {
    const appRoot = readFileSync(join(APP_ROOT, 'src/app/AppRoot.vue'), 'utf8')
    expect(appRoot).toContain('data-bedcode-surface')
    expect(appRoot).toContain("import './themeScope.css'")
  })
})

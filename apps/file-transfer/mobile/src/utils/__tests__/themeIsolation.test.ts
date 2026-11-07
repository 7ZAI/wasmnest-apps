/**
 * 应用主题隔离 + 下拉刷新指示器尺寸的静态锁
 *
 * 这两条都是「真机上才看得出来、但根因在样式表里」的问题，用真实宿主跑 E2E
 * 成本高且与设备状态耦合，因此在源码层做静态断言。
 *
 * 1. **主题隔离**（2026-11-06 真机反馈「被宿主的更改背景污染」）
 *    应用根 `.fv2-view` 同时带 `.mobile-ui`，宿主 glass / hyper 档有两条规则会
 *    往它身上叠背景——`:root[data-theme='glass'] .mobile-ui { background-image:
 *    var(--theme-ambient) }` 铺整屏光团渐变（左上 info 蓝 / 右上 error 红 /
 *    底部 warning 琥珀），以及 `:root[data-theme='x'] :is(…, .group-card,
 *    .settings-group, …)` 给分组卡加多层玻璃渐变 + backdrop-filter（后者会实时
 *    采样身后的壳根壁纸）。应用自持配色，必须把这些宿主外观设置挡在外面。
 *
 * 2. **下拉箭头尺寸**
 *    宿主不注入 Tailwind preflight，裸 `<svg>` 未给 width/height 时按 viewBox
 *    撑满整行（真机实测 ~110px，盖住列表首行）。
 *
 * 用 `?raw` 读样式而非 node:fs：本 app 的 tsconfig 不含 node types，
 * 用 node API 会引入 tsc 报错。
 */
import { describe, expect, it } from 'vitest'
import styles from '../../styles.css?raw'
import browseTab from '../BrowseTab.vue?raw'

/** 取某个选择器块的声明体（样式表结构简单，按首个 `{}` 切足够） */
function ruleBody(css: string, selector: string): string | null {
  const idx = css.indexOf(selector)
  if (idx < 0) return null
  const open = css.indexOf('{', idx)
  const close = css.indexOf('}', open)
  if (open < 0 || close < 0) return null
  return css.slice(open + 1, close)
}

describe('应用主题隔离（不被宿主外观设置污染）', () => {
  it('应用根显式清掉宿主铺的环境光渐变', () => {
    const body = ruleBody(styles, ':root[data-theme] .fv2-view')
    expect(body, '缺少 :root[data-theme] .fv2-view（压不过宿主主题档特异性）').not.toBeNull()
    expect(body).toContain('background-image: none')
    expect(body).toContain('isolation: isolate')
  })

  it('分组卡与设置分组压回实色并清掉 backdrop-filter', () => {
    for (const sel of [
      ':root[data-theme] .ft-app .group-card',
      ':root[data-theme] .ft-app .settings-group',
    ]) {
      const body = ruleBody(styles, sel)
      expect(body, `缺少 ${sel} 覆盖规则`).not.toBeNull()
      expect(body).toContain('backdrop-filter: none')
      expect(body).toContain('-webkit-backdrop-filter: none')
      expect(body).toContain('background: var(--ft-bg-card)')
    }
  })

  it('表面 token 不再引用宿主半透明背景变量', () => {
    // 宿主 glass 档把 bg-primary 混入 info 色相、group-bg 算成 40% 底色 + 白；
    // 应用底色必须自持，否则壁纸会透出来
    for (const token of [
      '--ft-bg-primary',
      '--ft-bg-secondary',
      '--ft-bg-card',
      '--ft-bg-tertiary',
      '--ft-bg-elevated',
    ]) {
      expect(styles, `${token} 不得绑定宿主 --mobile-* 背景 token`).not.toMatch(
        new RegExp(`${token}:\\s*var\\(--mobile-`),
      )
    }
  })

  it('深浅两档都给出不透明底色', () => {
    const dark = ruleBody(styles, '\n.ft-app {')
    const light = ruleBody(styles, 'html:not(.dark) .ft-app {')
    expect(dark).not.toBeNull()
    expect(light).not.toBeNull()
    for (const body of [dark ?? '', light ?? '']) {
      expect(body).toMatch(/--ft-bg-primary:\s*#[0-9a-f]{6}/i)
      expect(body).toMatch(/--ft-bg-card:\s*#[0-9a-f]{6}/i)
    }
  })
})

describe('下拉刷新指示器尺寸', () => {
  it('箭头有显式尺寸（宿主无 preflight，裸 svg 会撑满整行）', () => {
    const body = ruleBody(styles, '.fv2-pull-arrow {')
    expect(body, '缺少 .fv2-pull-arrow 规则').not.toBeNull()
    expect(body).toContain('width: 1.125rem')
    expect(body).toContain('height: 1.125rem')
    expect(body).toContain('flex-shrink: 0')
  })

  it('指示器容器不撑高单行（overflow: hidden + line-height: 1）', () => {
    const body = ruleBody(browseTab, '.fv2-pull {')
    expect(body, '缺少 .fv2-pull 规则').not.toBeNull()
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('line-height: 1')
  })
})

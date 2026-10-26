/**
 * E2E 驱动层 —— 宿主 webview 内的 DOM 操作原语
 *
 * ## 为什么用 `browser.execute` 而不是 `browser.tauri.execute`
 *
 * `browser.tauri.execute` 每次都要走一遍「webview → Rust IPC → webview」的往返，且
 * 它的回调**首参固定是 tauri api 对象**（user args 从第二参起，见 @wdio/tauri-plugin
 * 的 `(${script})(__wdio_tauri, ...__wdio_args)` 包装）。纯 DOM 操作走 WebDriver 原生的
 * `browser.execute`（Execute Script）更短也更快；只有需要「定向到某个窗口」或「调 tauri
 * 命令面」时才用 `browser.tauri.execute`（见 `shell.ts`）。
 *
 * ## 闭包限制（踩过的坑）
 *
 * WebDriver 会把回调 `toString()` 后丢进页面求值：**外层变量一律带不过去**（只有形参能
 * 经 `arguments` 传进来）。所以本文件每个原语都写成「自包含函数 + 形参」，函数体内
 * **不定义具名内部函数**（打包器给具名函数加 `__name` 包装后，那段源码会被原样送进页面
 * → 页面里没有 `__name` → ReferenceError）。需要复用的逻辑请复制粘贴或提升为模块级纯函数。
 *
 * ## 选择器纪律
 *
 * 只认 `data-testid`（应用侧约定，见 `docs/E2E.md`）。宿主壳元素没有 testid，用
 * 「语义属性 + 文本」定位（见 `shell.ts`），不依赖内部 class 名。
 */

/** 默认等待超时（毫秒）——单步交互的合理上限；机器慢时用显式传参放宽 */
export const DEFAULT_TIMEOUT = 10_000

/**
 * 宿主 webview 是否已就绪（前端挂载完成、document 可交互）
 *
 * debug 二进制走 `devUrl`（平台仓 vite dev server）；没起服务时页面是 `about:blank`，
 * 此时任何 DOM 断言都会「假绿」（元素不存在 ≠ 功能坏）。故所有用例前先等这一条。
 */
export async function waitForHostReady(timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(() => {
          if (document.readyState !== 'complete') return false
          if (window.location.href === 'about:blank') return false
          return document.body !== null && document.body.childElementCount > 0
        })
      } catch {
        // 页面还没建好时 execute 会抛（无 browsing context）——当作「还没就绪」
        return false
      }
    },
    {
      timeout,
      interval: 250,
      timeoutMsg:
        '宿主 webview 未就绪（页面空白）。检查：平台仓 vite dev server 是否在 1420 端口；' +
        'debug 二进制走 devUrl，不启 dev server 时页面是 about:blank。',
    },
  )
}

/** 元素是否存在（不关心可见性） */
export function exists(testid: string): Promise<boolean> {
  return browser.execute(
    (t: string) => document.querySelector(`[data-testid="${t}"]`) !== null,
    testid,
  )
}

/**
 * 元素是否可见
 *
 * 判定 = 存在 + 非 `display:none` / `visibility:hidden` + 有布局盒（`getClientRects()`
 * 非空）。只看「存在」会把过渡退场中的旧面板算成可见，分区切换类断言必须用可见性。
 */
export function visible(testid: string): Promise<boolean> {
  return browser.execute((t: string) => {
    const el = document.querySelector(`[data-testid="${t}"]`)
    if (!el) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return el.getClientRects().length > 0
  }, testid)
}

/** 等待元素存在且解除禁用 */
export async function waitForEnabled(testid: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
  await browser.waitUntil(async () => (await exists(testid)) && !(await isDisabled(testid)), {
    timeout,
    interval: 120,
    timeoutMsg: `等待元素可用超时：[data-testid="${testid}"]`,
  })
}

/** 等待元素存在且进入禁用态 */
export async function waitForDisabled(testid: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
  await browser.waitUntil(async () => (await exists(testid)) && (await isDisabled(testid)), {
    timeout,
    interval: 120,
    timeoutMsg: `等待元素禁用超时：[data-testid="${testid}"]`,
  })
}

/** 等待表单控件值等于给定值（v-model 异步更新） */
export async function waitForValue(
  testid: string,
  expected: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await browser.waitUntil(async () => (await value(testid)) === expected, {
    timeout,
    interval: 120,
    timeoutMsg: `等待输入值超时：[data-testid="${testid}"] 期望「${expected}」`,
  })
}

/** 元素文本（trim 后；不存在返回 null） */
export function text(testid: string): Promise<string | null> {
  return browser.execute((t: string) => {
    const el = document.querySelector(`[data-testid="${t}"]`)
    return el ? (el.textContent || '').trim() : null
  }, testid)
}

/** 同 testid 的全部元素文本（列表） */
export function texts(testid: string): Promise<string[]> {
  return browser.execute((t: string) => {
    const els = Array.from(document.querySelectorAll(`[data-testid="${t}"]`))
    return els.map((el) => (el.textContent || '').trim())
  }, testid)
}

/** 元素属性值（不存在返回 null） */
export function attr(testid: string, name: string): Promise<string | null> {
  return browser.execute(
    (t: string, n: string) => {
      const el = document.querySelector(`[data-testid="${t}"]`)
      return el ? el.getAttribute(n) : null
    },
    testid,
    name,
  )
}

/** 表单控件当前值（读 DOM property；`attr` 读不到 v-model 的 value） */
export function value(testid: string): Promise<string | null> {
  return browser.execute((t: string) => {
    const el = document.querySelector(`[data-testid="${t}"]`) as
      (HTMLElement & { value?: string }) | null
    return el && typeof el.value === 'string' ? el.value : null
  }, testid)
}

/** 写表单值并派发 input 事件（模拟用户输入，供 v-model 接收） */
export function setValue(testid: string, next: string): Promise<boolean> {
  return browser.execute(
    (t: string, v: string) => {
      const el = document.querySelector(`[data-testid="${t}"]`) as
        (HTMLElement & { value?: string }) | null
      if (!el) return false
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    testid,
    next,
  )
}

/** 同 testid 的元素个数 */
export function count(testid: string): Promise<number> {
  return browser.execute(
    (t: string) => document.querySelectorAll(`[data-testid="${t}"]`).length,
    testid,
  )
}

/**
 * 元素是否处于禁用态（读 DOM 属性 `disabled`，不是属性存在性）
 *
 * 「按钮存在但禁用」与「按钮不存在」是两种不同的产品状态（授权门控 / 未安装无该动作），
 * 断言时必须分开，故单列一个原语。
 */
export function isDisabled(testid: string): Promise<boolean> {
  return browser.execute((t: string) => {
    const el = document.querySelector(`[data-testid="${t}"]`) as
      (HTMLElement & { disabled?: boolean }) | null
    return el ? el.disabled === true : false
  }, testid)
}

/**
 * 点击元素（真实 click 事件，冒泡）
 *
 * 走 `HTMLElement.click()` 而非合成 MouseEvent：与用户真点同路径，且 `disabled` 按钮
 * 天然点不动（合成事件会绕过 disabled，测不出「按钮禁用」这类真实约束）。
 *
 * @returns 是否找到并点击了元素
 */
export function click(testid: string): Promise<boolean> {
  return browser.execute((t: string) => {
    const el = document.querySelector(`[data-testid="${t}"]`) as HTMLElement | null
    if (!el) return false
    el.click()
    return true
  }, testid)
}

/** 按「选择器 + 精确文本」点击（宿主壳元素没有 testid 时的兜底定位） */
export function clickByText(selector: string, needle: string): Promise<boolean> {
  return browser.execute(
    (sel: string, txt: string) => {
      const els = Array.from(document.querySelectorAll(sel))
      const hit = els.find((el) => (el.textContent || '').trim() === txt) as HTMLElement | undefined
      if (!hit) return false
      hit.click()
      return true
    },
    selector,
    needle,
  )
}

/** 点击 `[data-testid][data-*="value"]` 的单个元素（列表项按业务键定位） */
export function clickByData(testid: string, name: string, expected: string): Promise<boolean> {
  return browser.execute(
    (t: string, n: string, v: string) => {
      const el = document.querySelector(
        `[data-testid="${t}"][${n}="${CSS.escape(v)}"]`,
      ) as HTMLElement | null
      if (!el) return false
      el.click()
      return true
    },
    testid,
    name,
    expected,
  )
}

/** 等待元素出现且可见 */
export async function waitFor(testid: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
  await browser.waitUntil(() => visible(testid), {
    timeout,
    interval: 120,
    timeoutMsg: `等待元素出现且可见超时：[data-testid="${testid}"]`,
  })
}

/** 等待元素消失或不可见 */
export async function waitGone(testid: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
  await browser.waitUntil(async () => !(await visible(testid)), {
    timeout,
    interval: 120,
    timeoutMsg: `等待元素消失超时：[data-testid="${testid}"]`,
  })
}

/** 等待元素文本包含子串 */
export async function waitForText(
  testid: string,
  needle: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const t = await text(testid)
      return t !== null && t.includes(needle)
    },
    {
      timeout,
      interval: 150,
      timeoutMsg: `等待文本包含「${needle}」超时：[data-testid="${testid}"]`,
    },
  )
}

/** 等待元素文本等于给定值 */
export async function waitForTextEquals(
  testid: string,
  expected: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await browser.waitUntil(async () => (await text(testid)) === expected, {
    timeout,
    interval: 120,
    timeoutMsg: `等待文本超时：[data-testid="${testid}"] 期望「${expected}」`,
  })
}

/** 等待元素属性等于给定值（状态位断言用，不等固定 sleep） */
export async function waitForAttr(
  testid: string,
  name: string,
  expected: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await browser.waitUntil(async () => (await attr(testid, name)) === expected, {
    timeout,
    interval: 120,
    timeoutMsg: `等待属性超时：[data-testid="${testid}"][${name}] 期望「${expected}」`,
  })
}

/** 等待元素属性消失（如 details 收起后 `open` 不再存在） */
export async function waitForAttrGone(
  testid: string,
  name: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await browser.waitUntil(async () => (await attr(testid, name)) === null, {
    timeout,
    interval: 120,
    timeoutMsg: `等待属性消失超时：[data-testid="${testid}"][${name}]`,
  })
}

/** 页面正文文本（断言用兜底：某段文案出现了没） */
export function bodyText(): Promise<string> {
  return browser.execute(() => (document.body ? document.body.innerText : ''))
}

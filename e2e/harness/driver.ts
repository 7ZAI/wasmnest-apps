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

/**
 * 向输入框写入文本（先清空，再赋值 + 派发 input 事件）
 *
 * 没有走键盘事件：桌面 WebDriver 的 `elementSendKeys` 要先按 testid 找元素再转发，
 * 而本套件所有原语都走 `browser.execute`（见文件头「为什么用 browser.execute」）。
 * 赋值 + `input` 事件是 Vue `v-model` 的实际监听路径，行为等价；代价是不覆盖
 * 「真实键盘管线」（IME / 组合输入）——那类问题归终端域的单测与真机验证。
 *
 * 兼容两种 testid 落点：直接落在 `<input>` 上（原生输入），或落在**字段容器**上
 * （TextInput / Select 这类自绘控件把 testid 放在 .form-group 上）——后者向内找
 * 真正的输入元素，否则赋值会落到 div 上、v-model 收不到。
 *
 * @returns 是否找到输入元素
 */
export function typeInto(testid: string, value: string): Promise<boolean> {
  return browser.execute(
    (t: string, v: string) => {
      const root = document.querySelector(`[data-testid="${t}"]`)
      if (!root) return false
      const el = (
        root.matches('input, textarea') ? root : root.querySelector('input, textarea')
      ) as (HTMLElement & { value?: string }) | null
      if (!el) return false
      el.focus()
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    testid,
    value,
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

/** 等待同 testid 的元素个数达到至少 n（列表新增类判据：库里有历史行时不能只看「存在」） */
export async function waitForCount(
  testid: string,
  atLeast: number,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await browser.waitUntil(async () => (await count(testid)) >= atLeast, {
    timeout,
    interval: 120,
    timeoutMsg: `等待元素数量 ≥ ${atLeast} 超时：[data-testid="${testid}"]`,
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

/** 页面正文文本（断言用兜底：某段文案出现了没） */
export function bodyText(): Promise<string> {
  return browser.execute(() => (document.body ? document.body.innerText : ''))
}

/**
 * 宿主 fs 授权弹窗的「允许本次」按钮
 *
 * 宿主弹窗（平台仓 `FsAuthDialog.vue`）只给「以后都拒绝」挂了 testid，允许按钮
 * 是页脚最后一个按钮；按这个结构定位，不依赖宿主文案语言。
 */
export async function allowFsAuthIfPresent(): Promise<boolean> {
  return browser.execute(() => {
    const denyAlways = document.querySelector('[data-testid="fs-auth-deny-always"]')
    const footer = denyAlways?.parentElement
    const buttons = footer ? Array.from(footer.querySelectorAll('button')) : []
    const allow = buttons[buttons.length - 1] as HTMLButtonElement | undefined
    if (!allow) return false
    allow.click()
    return true
  })
}

/** 同 testid 全部元素某属性的值（列表；不存在元素返回 null） */
export function attrs(testid: string, name: string): Promise<(string | null)[]> {
  return browser.execute(
    (t: string, n: string) =>
      Array.from(document.querySelectorAll(`[data-testid="${t}"]`)).map((el) =>
        el.getAttribute(n),
      ),
    testid,
    name,
  )
}

/** 点第 index 个同 testid 元素（列表切换类断言） */
export function clickNth(testid: string, index: number): Promise<boolean> {
  return browser.execute(
    (t: string, i: number) => {
      const el = document.querySelectorAll(`[data-testid="${t}"]`)[i] as HTMLElement | undefined
      if (!el) return false
      el.click()
      return true
    },
    testid,
    index,
  )
}

/** 点同 testid 里文本包含 needle 的元素（卡片按路径/名称定位） */
export function clickContaining(testid: string, needle: string): Promise<boolean> {
  return browser.execute(
    (t: string, n: string) => {
      const els = Array.from(
        document.querySelectorAll(`[data-testid="${t}"]`),
      ) as HTMLElement[]
      const hit = els.find((el) => (el.textContent || '').includes(n))
      if (!hit) return false
      hit.click()
      return true
    },
    testid,
    needle,
  )
}

/**
 * 终端真实字节（经 app 暴露的只读 xterm buffer 句柄；WebGL 画布读不到 DOM 文本）
 *
 * 句柄由 `TerminalPreview.vue` 在建立终端时挂到 `window.__bedcodeTerminalText`，
 * 卸载时移除；无句柄（终端未挂载）返回空串。
 */
export function terminalBufferText(): Promise<string> {
  return browser.execute(() => {
    const fn = (window as unknown as { __bedcodeTerminalText?: () => string })
      .__bedcodeTerminalText
    return fn ? fn() : ''
  })
}

/** 等终端 buffer 出现真实输出（PTY 有字节） */
export async function waitForTerminalOutput(timeout = 15_000): Promise<string> {
  let last = ''
  await browser.waitUntil(
    async () => {
      last = await terminalBufferText()
      return last.trim().length > 0
    },
    { timeout, interval: 200, timeoutMsg: '终端 buffer 超时仍无输出（PTY 无字节）' },
  )
  return last
}

/**
 * 处理 run.start 触发的宿主 fs 授权弹窗
 *
 * 首次在项目目录部署 agent 原生扩展要读插件资源模板（`fs_read`），宿主按未授权
 * 路径弹窗并最多等 30s；真实用户会点「允许」，E2E 也走 UI，不预置授权记录。
 * 没有弹窗（已授权路径）时最多等 2.5s 就返回 0，不拖慢常规用例。
 */
export async function allowFsAuthPrompts(idle = 800, timeout = 8000): Promise<number> {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const firstSeenDeadline = Date.now() + 2500
  while (Date.now() < firstSeenDeadline) {
    if (await allowFsAuthIfPresent()) break
    await delay(120)
  }
  const first = Date.now() < firstSeenDeadline
  if (!first) return 0

  let granted = 1
  let lastSeen = Date.now()
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await delay(120)
    if (await allowFsAuthIfPresent()) {
      granted += 1
      lastSeen = Date.now()
    } else if (Date.now() - lastSeen >= idle) {
      break
    }
  }
  return granted
}

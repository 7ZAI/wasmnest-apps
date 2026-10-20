/**
 * 移动端驱动 —— 真机上的 Tauri WebView
 *
 * ## 与桌面驱动的关系
 *
 * `driver.ts` 是「宿主 webview 内的 DOM 原语」，由 WebDriver 提供执行通道；
 * 本文件是同一组原语在**真机 WebView**上的实现，执行通道换成 CDP：
 *
 * ```text
 * adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
 *   → http://127.0.0.1:<port>/json/list        （发现页面目标）
 *   → ws://127.0.0.1:<port>/devtools/page/<id>  （CDP 会话）
 * ```
 *
 * 为什么不用「纯 adb 坐标点击」当主路径：
 * - 坐标要经过 `CSS px × dpr + WebView 在屏幕上的偏移` 换算，刘海 / 状态栏 / 缩放任何一处
 *   变化都会把点击打到隔壁元素，而失败表现是「功能坏了」；
 * - 断言只能靠截图 / OCR，无法区分「按钮禁用」与「按钮不存在」。
 *
 * 因此：**CDP 负责定位与断言，触摸走 CDP `Input.dispatchTouchEvent`**（真实触摸事件管线，
 * 坐标是 CSS px，无需换算）；`tapViaAdb` 保留给需要**系统级触摸**的少量冒烟用例
 * （`WASMNEST_E2E_ADB_TAP=1` 时才走），坐标经 `uiautomator dump` 的 WebView 边界校准。
 *
 * ## 前置（fail-visible）
 *
 * - 真机在线且已授权（`adb devices` 唯一 `device`）；
 * - 安装的是 **debug APK**：release 不调用 `setWebContentsDebuggingEnabled`，没有调试套接字；
 * - 应用包名 / Activity 与 `tauri.conf.json` 一致（默认 `com.wasmnest.mobile/.MainActivity`）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  adbExecOut,
  adbShell,
  clearAppData,
  devtoolsSocket,
  forceStop,
  forwardTcp,
  installApk,
  pidOf,
  pickSerial,
  removeForward,
  resolveAdbBinary,
  runAdb,
  startActivity,
  type AdbClient,
} from './adb'
import { CdpSession } from './cdp'

/** 默认包名 / Activity（与平台仓 `tauri.conf.json` 的 identifier 一致） */
const DEFAULT_PACKAGE = 'com.wasmnest.mobile'
const DEFAULT_ACTIVITY = '.MainActivity'

/** 单步等待的默认预算：真机冷启动 + wasm 编译比桌面慢一个量级 */
export const MOBILE_TIMEOUT = 30_000

export interface MobileLaunchOptions {
  /** 指定设备（缺省 = `ANDROID_SERIAL` 或唯一在线设备） */
  serial?: string
  /** adb 二进制（缺省按 ANDROID_HOME → PATH 解析） */
  adbBin?: string
  packageName?: string
  activity?: string
  /** 需要安装的 APK；缺省要求设备上已安装 */
  apkPath?: string
  /** 启动前清空应用数据（凭据 / 历史 / 插件抽取目录） */
  clearData?: boolean
  /** 启动前先装 APK */
  install?: boolean
  /** CDP 本地端口（adb forward 用；与设备无关，可固定） */
  cdpPort?: number
  /** 失败现场（截图 / logcat）落点 */
  artifactsDir?: string
  /** 启动后等待的 CSS 选择器（缺省只等 document 可交互） */
  readySelector?: string
  /** 关闭时顺手 force-stop（默认 false：保留现场便于排查） */
  stopOnClose?: boolean
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 移动端应用句柄：adb 生命周期 + CDP DOM 原语 */
export class MobileApp {
  private readonly adb: AdbClient
  private readonly pkg: string
  private readonly activity: string
  private readonly cdpPort: number
  private readonly artifactsDir: string
  private readonly stopOnClose: boolean
  private cdp: CdpSession | null = null
  private forwarded = false

  private constructor(adb: AdbClient, options: Required<Pick<MobileLaunchOptions, 'packageName' | 'activity' | 'cdpPort' | 'artifactsDir' | 'stopOnClose'>>) {
    this.adb = adb
    this.pkg = options.packageName
    this.activity = options.activity
    this.cdpPort = options.cdpPort
    this.artifactsDir = options.artifactsDir
    this.stopOnClose = options.stopOnClose
    mkdirSync(this.artifactsDir, { recursive: true })
  }

  /**
   * 启动应用并连上 CDP
   *
   * 顺序不能换：先 force-stop（清掉上一轮页面），再 `am start -S`（冷启动），
   * 然后才等 pid / 调试套接字——进程复用会让 CDP 连到上一轮的旧页面。
   */
  static async launch(options: MobileLaunchOptions = {}): Promise<MobileApp> {
    const bin = options.adbBin ?? resolveAdbBinary()
    const serial = await pickSerial(bin, options.serial ?? process.env.ANDROID_SERIAL)
    const adb: AdbClient = { bin, serial }
    const app = new MobileApp(adb, {
      packageName: options.packageName ?? DEFAULT_PACKAGE,
      activity: options.activity ?? DEFAULT_ACTIVITY,
      cdpPort: options.cdpPort ?? Number(process.env.WASMNEST_E2E_CDP_PORT ?? 19333),
      artifactsDir: options.artifactsDir ?? join(process.cwd(), 'e2e', 'artifacts'),
      stopOnClose: options.stopOnClose ?? false,
    })

    // 安装是编排器的职责（`adb install` 在慢设备上超出单条用例预算）；
    // 只有显式 `install: true` 时才在这里装（用于不经过编排器的调试场景）。
    if (options.install) {
      const apk = options.apkPath
      if (!apk) throw new Error('install=true 时必须给 apkPath')
      await installApk(adb, apk)
    } else {
      const installed = await adbShell(adb, `pm path ${app.pkg}`)
      if (!installed.includes('package:')) {
        throw new Error(
          `设备上未安装 ${app.pkg}。\n` +
            '  先构建 debug APK：cd <平台仓>/wasmnest-mobile && pnpm run tauri:android:build:fast\n' +
            '  或显式传 --apk <app-arm64-debug.apk>',
        )
      }
    }

    if (options.clearData) {
      await clearAppData(adb, app.pkg)
    }

    // 真机常年锁屏：先唤醒再启动，否则 am start 成功但页面仍在锁屏后面
    await adbShell(adb, 'input keyevent KEYCODE_WAKEUP').catch(() => undefined)
    await adbShell(adb, 'wm dismiss-keyguard').catch(() => undefined)
    await forceStop(adb, app.pkg)
    await startActivity(adb, `${app.pkg}/${app.activity}`)
    await app.attach(options.readySelector)

    return app
  }

  /** 设备 serial（失败信息里点名用） */
  get serial(): string {
    return this.adb.serial
  }

  // ==================== CDP 原语 ====================

  /** 执行一段 JS 表达式，返回结构化值（异常原样抛出，不吞成 undefined） */
  async eval<T = unknown>(expression: string): Promise<T> {
    const cdp = this.requireCdp()
    const response = await cdp.request<{
      result?: { value?: unknown; description?: string }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })

    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'unknown'
      throw new Error(`移动端 JS 执行失败：${detail}\n  表达式：${expression.slice(0, 500)}`)
    }
    return response.result?.value as T
  }

  /** 元素是否存在（不关心可见性） */
  exists(selector: string): Promise<boolean> {
    return this.eval<boolean>(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  }

  /** 元素是否可见（存在 + 非 display:none/visibility:hidden + 有布局盒） */
  visible(selector: string): Promise<boolean> {
    return this.eval<boolean>(visibleExpression(selector))
  }

  /** 元素文本（trim 后；不存在返回 null） */
  text(selector: string): Promise<string | null> {
    return this.eval<string | null>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.textContent || '').trim() : null })()`,
    )
  }

  /** 元素属性（不存在返回 null） */
  attr(selector: string, name: string): Promise<string | null> {
    return this.eval<string | null>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.getAttribute(${JSON.stringify(name)}) : null })()`,
    )
  }

  /** 同选择器的元素个数 */
  count(selector: string): Promise<number> {
    return this.eval<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  }

  /** 等待元素出现且可见（等状态，不 sleep） */
  async waitFor(selector: string, timeout = MOBILE_TIMEOUT): Promise<void> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await this.visible(selector)) return
      await sleep(120)
    }
    throw new Error(`移动端等待元素超时（${timeout}ms）：${selector}\n${await this.pageDigest()}`)
  }

  /** 等待元素消失或不可见（退场过渡 / KeepAlive 场景） */
  async waitGone(selector: string, timeout = MOBILE_TIMEOUT): Promise<void> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (!(await this.visible(selector))) return
      await sleep(120)
    }
    throw new Error(`移动端等待元素消失超时（${timeout}ms）：${selector}`)
  }

  /** 等待元素文本包含子串 */
  async waitForText(selector: string, needle: string, timeout = MOBILE_TIMEOUT): Promise<void> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const current = await this.text(selector)
      if (current && current.includes(needle)) return
      await sleep(150)
    }
    const current = await this.text(selector)
    throw new Error(`移动端等待文本超时（${timeout}ms）：${selector} 应包含「${needle}」，实际=${JSON.stringify(current)}`)
  }

  /** 等待元素属性等于给定值（状态位断言用 `data-*` 而不是文案） */
  async waitForAttr(selector: string, name: string, expected: string, timeout = MOBILE_TIMEOUT): Promise<void> {
    const deadline = Date.now() + timeout
    let last: string | null = null
    while (Date.now() < deadline) {
      last = await this.attr(selector, name)
      if (last === expected) return
      await sleep(120)
    }
    throw new Error(`移动端等待属性超时（${timeout}ms）：${selector}[${name}] 期望「${expected}」，实际=${JSON.stringify(last)}`)
  }

  /**
   * 点击元素（真实触摸事件）
   *
   * 走 CDP `Input.dispatchTouchEvent`：坐标是 CSS px，由页面自己算，不经过 dpr / 状态栏偏移；
   * 对 Vue 的 `@click` 等价于用户手指点下（会触发 touchstart/touchend/click 链路）。
   */
  async tap(selector: string): Promise<void> {
    const rect = await this.rect(selector)
    await this.touch(rect.x + rect.width / 2, rect.y + rect.height / 2)
  }

  /** 按「选择器 + 精确文本」点击（宿主壳没有 testid 时用于应用卡 / 导航项） */
  async tapByText(selector: string, needle: string): Promise<void> {
    const rect = await this.eval<Rect | null>(`(() => {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      const hit = els.find((el) => (el.textContent || '').trim() === ${JSON.stringify(needle)})
      if (!hit) return null
      const r = hit.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
    if (!rect) throw new Error(`移动端找不到文本为「${needle}」的元素（${selector}）`)
    await this.touch(rect.x + rect.width / 2, rect.y + rect.height / 2)
  }

  /** 等待带有指定 aria-label 前缀的元素出现（壳层应用卡） */
  async waitForAriaLabelPrefix(prefix: string, timeout = MOBILE_TIMEOUT): Promise<void> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const found = await this.eval<boolean>(
        `Array.from(document.querySelectorAll('[aria-label]')).some((el) => (el.getAttribute('aria-label') || '').startsWith(${JSON.stringify(prefix)}))`,
      )
      if (found) return
      await sleep(200)
    }
    const labels = await this.eval<string[]>(
      `Array.from(document.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label') || '').slice(0, 40)`,
    )
    throw new Error(
      `移动端等待 aria-label 以「${prefix}」开头的元素超时（${timeout}ms）；现有标签=${JSON.stringify(labels)}`,
    )
  }

  /**
   * 通过 aria-label 前缀点击（宿主壳应用卡：`aria-label` = 应用名 [+ 状态]）
   *
   * 壳没有 `data-testid`（平台仓未加，与桌面壳同口径），应用名来自 `plugin.json`，
   * 与界面语言无关，是壳层最稳的锚点。
   */
  async tapByAriaLabelPrefix(prefix: string): Promise<void> {
    const rect = await this.eval<Rect | null>(`(() => {
      const els = Array.from(document.querySelectorAll('[aria-label]'))
      const hit = els.find((el) => (el.getAttribute('aria-label') || '').startsWith(${JSON.stringify(prefix)}))
      if (!hit) return null
      const r = hit.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
    if (!rect) {
      const labels = await this.eval<string[]>(
        `Array.from(document.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label') || '').slice(0, 40)`,
      )
      throw new Error(`移动端找不到 aria-label 以「${prefix}」开头的元素；现有标签=${JSON.stringify(labels)}`)
    }
    await this.touch(rect.x + rect.width / 2, rect.y + rect.height / 2)
  }

  /** 聚焦输入框并输入文本（`Input.insertText` 走真实输入管线，触发 v-model） */
  async type(selector: string, text: string): Promise<void> {
    const focused = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      el.focus()
      if ('value' in el) {
        el.value = ''
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return true
    })()`)
    if (!focused) throw new Error(`移动端输入框不存在：${selector}`)

    try {
      await this.requireCdp().request('Input.insertText', { text })
    } catch {
      // 个别 WebView 未实现 Input.insertText：退化为「赋值 + input 事件」，
      // 断言仍能验证业务链路，但会少覆盖一次真实键盘输入。
      await this.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        el.value = ${JSON.stringify(text)}
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
    }

    // 输入完立刻收起软键盘（见 dismissIme）：输入法是浮在 WebView 之上的独立原生窗口，
    // 它覆盖区域的触摸会被 IME 吃掉——「输入地址 → 点确认」这一步会静默失效。
    await this.dismissIme()
  }

  /**
   * 收起软键盘（IME）
   *
   * 为什么需要：软键盘是**独立的原生窗口**，浮在 WebView 之上。CDP 的触摸事件虽然
   * 直接投给渲染进程，但坐标落点若被 IME 窗口覆盖，事件会被 IME 吃掉，WebView 收不到。
   * 典型症状（2026-10-20 真机实测）：输入完地址点「确认」，面板反而关闭了、连接根本没
   * 发起——看着像「点了没反应」，实则是触摸被键盘吞了。
   *
   * 为什么用 keyevent 111（ESC）而不是 4（BACK）：ESC 由 IME 优先消费，只收键盘；
   * BACK 会触发应用的返回键处理（面板 / 页面会被退掉），把「收键盘」变成「退界面」。
   */
  async dismissIme(): Promise<void> {
    await adbShell(this.adb, 'input keyevent 111').catch(() => undefined)
  }

  /**
   * 通过 `adb shell input tap` 点击（系统级触摸，坐标经 WebView 边界校准）
   *
   * 只建议用于「必须验证系统 InputManager 路径」的冒烟点：`uiautomator dump` 拿到的
   * WebView 边界是屏幕物理像素，CSS 坐标乘以缩放后加上边界原点即可。校准失败会抛错
   * 并打印 dump 片段，不静默退回 CDP 触摸（否则用例名义走 adb、实际没走）。
   */
  async tapViaAdb(selector: string, options: { verify?: () => Promise<boolean> } = {}): Promise<void> {
    const rect = await this.rect(selector)
    const bounds = await this.webviewBounds()
    const viewport = await this.eval<{ width: number; height: number }>(
      '({ width: window.innerWidth, height: window.innerHeight })',
    )
    const scaleX = bounds.width / viewport.width
    const scaleY = bounds.height / viewport.height
    const x = Math.round(bounds.x + (rect.x + rect.width / 2) * scaleX)
    const y = Math.round(bounds.y + (rect.y + rect.height / 2) * scaleY)

    await adbShell(this.adb, `input tap ${x} ${y}`)

    if (options.verify) {
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        if (await options.verify()) return
        await sleep(100)
      }
      throw new Error(
        `adb tap 未生效：${selector} → 屏幕 (${x}, ${y})；` +
          `webviewBounds=${JSON.stringify(bounds)} viewport=${JSON.stringify(viewport)} ` +
          `rect=${JSON.stringify(rect)}（坐标换算或设备缩放与预期不符）`,
      )
    }
  }

  /** 元素矩形（CSS px，视口坐标系） */
  async rect(selector: string): Promise<Rect> {
    const rect = await this.eval<Rect | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      // 目标可能在滚动容器下方：先居中再取矩形，避免触摸落到视口外
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      throw new Error(`移动端元素不存在或没有布局盒：${selector}（rect=${JSON.stringify(rect)}）`)
    }
    return rect
  }

  // ==================== 失败现场 ====================

  /** 截图落盘（失败现场；返回路径） */
  async screenshot(name = `mobile-${Date.now()}.png`): Promise<string> {
    const png = await adbExecOut(this.adb, ['screencap', '-p'], 30_000)
    const path = join(this.artifactsDir, name.endsWith('.png') ? name : `${name}.png`)
    writeFileSync(path, png)
    return path
  }

  /** logcat 尾部落盘（失败现场；返回路径） */
  async dumpLogcat(name = `logcat-${Date.now()}.log`, lines = 600): Promise<string> {
    const out = await runAdb(this.adb, ['logcat', '-d', '-v', 'threadtime', '-t', String(lines)], {
      timeoutMs: 30_000,
    })
    const path = join(this.artifactsDir, name.endsWith('.log') ? name : `${name}.log`)
    writeFileSync(path, out)
    return path
  }

  /** 页面摘要（等待超时的失败信息：可见文本 + 关键 testid） */
  async pageDigest(): Promise<string> {
    try {
      return await this.eval<string>(`(() => {
        const ids = Array.from(document.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid')).slice(0, 30)
        const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 600)
        return 'testids=' + JSON.stringify(ids) + '\\n  text=' + text
      })()`)
    } catch (error) {
      return `页面摘要不可用：${error instanceof Error ? error.message : String(error)}`
    }
  }

  /** 关闭（摘 adb forward、关 CDP；默认不杀应用） */
  async close(): Promise<void> {
    if (this.forwarded) {
      await removeForward(this.adb, this.cdpPort)
      this.forwarded = false
    }
    this.cdp?.close()
    this.cdp = null
    if (this.stopOnClose) {
      await forceStop(this.adb, this.pkg)
    }
  }

  // ==================== 内部：连接 ====================

  private async attach(readySelector?: string): Promise<void> {
    const pid = await this.waitForPid()
    const socket = await this.waitForDevtoolsSocket(pid)
    await forwardTcp(this.adb, this.cdpPort, `localabstract:${socket}`)
    this.forwarded = true

    const wsUrl = await this.waitForPageTarget()
    this.cdp = await CdpSession.open(wsUrl)

    // 页面可交互（冷启动时 document 先就绪、Vue 挂载后才有元素）
    const deadline = Date.now() + MOBILE_TIMEOUT
    while (Date.now() < deadline) {
      const ready = await this.eval<boolean>(
        `document.readyState === 'complete' && document.body !== null && document.body.childElementCount > 0`,
      )
      if (ready) break
      await sleep(150)
    }
    if (readySelector) await this.waitFor(readySelector, MOBILE_TIMEOUT)
  }

  private async waitForPid(): Promise<number> {
    const deadline = Date.now() + MOBILE_TIMEOUT
    while (Date.now() < deadline) {
      const pid = await pidOf(this.adb, this.pkg)
      if (pid) return pid
      await sleep(200)
    }
    throw new Error(
      `启动后 ${MOBILE_TIMEOUT}ms 内没拿到 ${this.pkg} 的 pid（应用崩溃 / Activity 名不对 / 设备锁屏？）`,
    )
  }

  private async waitForDevtoolsSocket(pid: number): Promise<string> {
    const deadline = Date.now() + MOBILE_TIMEOUT
    while (Date.now() < deadline) {
      const socket = await devtoolsSocket(this.adb, pid)
      if (socket) return socket
      await sleep(300)
    }
    throw new Error(
      `没找到 ${this.pkg} 的 WebView 调试套接字（webview_devtools_remote_${pid}）。\n` +
        '  只有 **debug APK** 才开启 WebView 调试（wry 的 debug_assertions 分支）；\n' +
        '  若装的是 release 包，请改用 `pnpm run tauri:android:build:fast` 的产物。',
    )
  }

  private async waitForPageTarget(): Promise<string> {
    const deadline = Date.now() + MOBILE_TIMEOUT
    let lastError = ''
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.cdpPort}/json/list`, {
          signal: AbortSignal.timeout(2_000),
        })
        const targets = (await response.json()) as Array<{
          type?: string
          url?: string
          webSocketDebuggerUrl?: string
        }>
        const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
        const preferred = pages.find((t) => (t.url ?? '').includes('tauri')) ?? pages[0]
        if (preferred?.webSocketDebuggerUrl) return preferred.webSocketDebuggerUrl
        lastError = `targets=${JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url })))}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      await sleep(300)
    }
    throw new Error(`CDP 页面目标不可用（adb forward tcp:${this.cdpPort}）：${lastError}`)
  }

  private requireCdp(): CdpSession {
    if (!this.cdp) throw new Error('CDP 尚未连接（先 await MobileApp.launch()）')
    return this.cdp
  }

  /** 发送一次触摸（按下 + 抬起） */
  private async touch(x: number, y: number): Promise<void> {
    const cdp = this.requireCdp()
    const point = { x, y, radiusX: 2, radiusY: 2, force: 1 }
    await cdp.request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await sleep(30)
    await cdp.request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  /** 从 uiautomator dump 里取 WebView 的屏幕边界（tapViaAdb 的坐标基准） */
  private async webviewBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
    const dumpPath = '/sdcard/wasmnest-e2e-window.xml'
    await adbShell(this.adb, `uiautomator dump ${dumpPath}`)
    const xml = (await adbExecOut(this.adb, ['cat', dumpPath], 20_000)).toString('utf8')

    const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map((m) => m[0])
    const webview = nodes.find((node) => /class="[^"]*WebView"/.test(node)) ?? null
    const target = webview ?? nodes.find((node) => node.includes('bounds=')) ?? ''
    const bounds = target.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!bounds) {
      throw new Error(`uiautomator dump 里没有 bounds（前 500 字）：${xml.slice(0, 500)}`)
    }
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number) as [number, number, number, number]
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
  }
}

/** 可见性表达式（与桌面 `driver.ts` 的 visible 逐条同义） */
function visibleExpression(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return el.getClientRects().length > 0
  })()`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

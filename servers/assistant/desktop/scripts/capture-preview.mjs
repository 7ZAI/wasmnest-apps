/**
 * 助手界面截图与 DOM 探针
 *
 * 启动前先运行 `pnpm run preview`；本脚本只负责打开页面、等待界面挂载、
 * 截整窗图并导出关键元素的几何与计算样式。
 *
 * 用法：
 *   node scripts/capture-preview.mjs --state chat --theme light --name s0-chat-light
 *   node scripts/capture-preview.mjs --state locked --theme dark --viewport 800x600
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(APP_ROOT, '../../..')

const CHROME =
  process.env.CHROME_BIN ||
  '/home/binblink/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'
const PORT = Number(process.env.CDP_PORT || 9334)

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const state = arg('state', 'chat')
const theme = arg('theme', 'light')
const locale = arg('locale', 'zh-CN')
const viewport = arg('viewport', '1440x900')
const name = arg('name', `s0-${state}-${theme}`)
const baseUrl = arg('url', 'http://localhost:5182/')
const outDir = arg('out', join(REPO_ROOT, '.scratch/2026-11-20-assistant-floating-ui/shots'))
const [width, height] = viewport.split('x').map((value) => Number(value))

mkdirSync(outDir, { recursive: true })

const url = new URL(baseUrl)
if (state === 'mascot') {
  url.pathname = '/mascot.html'
  url.searchParams.set('motion', arg('motion', 'on'))
  url.searchParams.set('labels', arg('labels', '1'))
} else {
  url.searchParams.set('state', state)
}
url.searchParams.set('theme', theme)
url.searchParams.set('locale', locale)

const child = spawn(
  CHROME,
  [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
child.stderr.on('data', () => {})

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function fetchJson(path) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`)
  if (!response.ok) throw new Error(`${path} -> ${response.status}`)
  return response.json()
}

async function waitForTarget() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const list = await fetchJson('/json/list')
      const page = list.find((target) => target.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Chrome 尚未就绪
    }
    await sleep(200)
  }
  throw new Error('未拿到 Chrome page target')
}

const wsUrl = await waitForTarget()
const ws = new WebSocket(wsUrl)
await new Promise((done, fail) => {
  ws.addEventListener('open', done, { once: true })
  ws.addEventListener('error', fail, { once: true })
})

let nextId = 0
const pending = new Map()
const consoleLines = []
const exceptions = []

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleLines.push({
      level: message.params.type,
      text: (message.params.args || [])
        .map((item) => item.value ?? item.description ?? '')
        .join(' '),
    })
  }
  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails?.text ?? JSON.stringify(message.params))
  }
})

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails))
  }
  return result.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: url.toString() })

const readySelector = state === 'mascot' ? '.cell' : '[data-testid="nest-chat"], .nest-vault, [data-testid="nest-floatball"]'
let ready = false
const deadline = Date.now() + 25000
while (Date.now() < deadline) {
  try {
    ready = await evaluate(`Boolean(document.querySelector(${JSON.stringify(readySelector)}))`)
  } catch {
    ready = false
  }
  if (ready) break
  await sleep(300)
}

await sleep(800)

const probeExpression = `(() => {
  const round = (value) => Math.round(value * 10) / 10
  const pick = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      selector,
      rect: { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) },
      color: style.color,
      bg: style.backgroundColor,
      fontSize: style.fontSize,
      borderTop: style.borderTopWidth + ' ' + style.borderTopColor,
      borderRight: style.borderRightWidth + ' ' + style.borderRightColor,
      radius: style.borderRadius,
      padding: style.padding,
      overflow: style.overflow,
      display: style.display,
      gap: style.gap,
    }
  }
  const app = document.querySelector('.nest-chat, .nest-vault')
  const appStyle = app ? getComputedStyle(app) : null
  const readVar = (name) => (appStyle ? appStyle.getPropertyValue(name).trim() : '')
  return {
    title: document.title,
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    ready: Boolean(document.querySelector('[data-testid="nest-chat"], .nest-vault, [data-testid="nest-floatball"], .cell')),
    bodyText: document.body.innerText.slice(0, 3000),
    counts: {
      messages: document.querySelectorAll('.nest-msg').length,
      userMessages: document.querySelectorAll('.nest-msg--user').length,
      assistantMessages: document.querySelectorAll('.nest-msg--assistant').length,
      conversations: document.querySelectorAll('[data-testid="nest-conversation-item"]').length,
      markdownBlocks: document.querySelectorAll(
        '.nest-md h1, .nest-md h2, .nest-md h3, .nest-md ul, .nest-md ol, .nest-md pre, .nest-md code, .nest-msg__text h1, .nest-msg__text h2',
      ).length,
      floatBall: document.querySelectorAll('[data-testid="nest-floatball"]').length,
      quickPanel: document.querySelectorAll('[data-testid="nest-quickpanel"]').length,
      mascot: document.querySelectorAll('[data-testid="nest-mascot"]').length,
    },
    mascotState: document.querySelector('[data-testid="nest-mascot"]')?.getAttribute('data-mascot-state') ?? null,
    scroll: (() => {
      const element = document.querySelector('.nest-messages')
      if (!element) return null
      return {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }
    })(),
    textSample: (() => {
      const element = document.querySelector('.nest-msg__text, .nest-markdown')
      return element ? element.textContent.slice(0, 240) : null
    })(),
    vars: {
      nestBg: readVar('--nest-bg'),
      nestSurface: readVar('--nest-surface'),
      nestSurface2: readVar('--nest-surface-2'),
      nestText: readVar('--nest-text'),
      nestAccent: readVar('--nest-accent'),
      hostBg: getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim(),
      hostText: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
      hostFontSize: getComputedStyle(document.documentElement).getPropertyValue('--font-size-base').trim(),
    },
    elements: [
      pick('.nest-chat'),
      pick('.nest-vault'),
      pick('.nest-chat__body'),
      pick('.nest-chat__sidebar'),
      pick('.nest-chat__main'),
      pick('.nest-messages'),
      pick('.nest-msg--user .nest-msg__bubble'),
      pick('.nest-msg--assistant .nest-msg__bubble'),
      pick('.nest-composer'),
      pick('.nest-composer textarea, .nest-composer__input'),
      pick('[data-testid="nest-new-conversation"]'),
      pick('[data-testid="nest-open-settings"]'),
      pick('[data-testid="nest-open-memory"]'),
      pick('[data-testid="nest-open-audit"]'),
      pick('[data-testid="nest-floatball"]'),
      pick('[data-testid="nest-quickpanel"]'),
    ],
    navButtons: [...document.querySelectorAll('.nest-chat__settings-btn')].map((element) =>
      element.textContent.trim(),
    ),
  }
})()`

const probe = await evaluate(probeExpression)

await send('Page.bringToFront')
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'))
writeFileSync(
  join(outDir, `${name}.json`),
  JSON.stringify({ capturedAt: new Date().toISOString(), ready, probe, consoleLines, exceptions }, null, 2),
)

console.log(JSON.stringify({ ready, out: join(outDir, `${name}.png`), report: join(outDir, `${name}.json`) }))
if (!ready) console.log('BODY:', probe?.bodyText)

ws.close()
child.kill('SIGTERM')
process.exit(0)
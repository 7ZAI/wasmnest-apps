/**
 * G2 导入锁（应用仓静态测试）
 *
 * 契约来源：`.scratch/2026-10-21-host-runtime-distribution/CONTRACT.md` §2.2 与 §8.4
 * 「G2 导入锁」：只拿到应用仓 + 联网就要能构建，因此**构建链与 dev-host 不得引平台仓**：
 *  - 不得 import `scripts/platform-paths.mjs`（那是 CI / 平台集成脚本的跨仓 resolver）；
 *  - 不得出现 `../../../../../wasmnest/...` 这类平台仓相对路径；
 *  - SDK 工具（plugin-watch / wasm-hash / manifest-gen）必须经**包名**导入；
 *  - 默认产物目录 = app 内 `.build/plugins`（不落 vite outDir `dist`，否则每次前端构建自删）。
 *
 * 判据形态：源码级断言（这些是"链路上不许出现的东西"，运行时测不到）。
 * 反例覆盖：故意构造含禁止 import 的源码字符串，确认锁真的会红（防空转）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { APPS_ROOT, listProjects } from '../lib/projects.mjs'

/**
 * 参与 G2 的桌面工程（**全部分组**：apps + servers —— 服务型 wasm 随包分发，
 * 同样「只拿到应用仓 + 联网就要能构建」，不能因为住在 `servers/` 就漏锁）。
 */
const DESKTOP_PROJECTS = listProjects({ ends: ['desktop'] })

/**
 * 参与 G2 的「无平台仓也必须能跑」文件清单（相对应用仓根）。
 *
 * spec D11 ⑥ 点名：各 build.js、各 dev-host.js、scripts/e2e.mjs；
 * `e2e/wdio.conf.ts` 一并纳入——它是历史上自己拼平台仓宿主路径的那一处。
 * `scripts/e2e-dual.mjs` **不在禁列**：移动侧真要跑就得拿平台仓的 debug APK
 * （out of scope），只要求桌面宿主解析走同一个 resolver。
 */
function buildChainFiles() {
  return [
    ...DESKTOP_PROJECTS.flatMap((p) => [`${p.rel}/scripts/build.js`, `${p.rel}/scripts/dev-host.js`]),
    'scripts/e2e.mjs',
    'e2e/wdio.conf.ts',
  ]
}

/** 桌面 build.js 路径（断言用） */
function desktopBuildJs(project) {
  return join(APPS_ROOT, project.rel, 'scripts', 'build.js')
}

/** 禁止出现的模式：命中即点名文件与行 */
const FORBIDDEN = [
  { pattern: /platform-paths\.mjs/, why: '构建链不得 import 平台仓 resolver' },
  { pattern: /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/wasmnest\//, why: '不得出现平台仓相对路径' },
  { pattern: /wasmnest\/wasmnest-desktop\/(scripts|packages)\//, why: '不得直引平台仓内部路径' },
]

function offenders(source) {
  const hits = []
  source.split(/\r?\n/).forEach((line, i) => {
    for (const { pattern, why } of FORBIDDEN) {
      // 注释里点名「已退役的路径」是允许的（文档性说明），只禁可执行代码行
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
      if (pattern.test(code)) hits.push(`  ${pattern.source} —— ${why}（第 ${i + 1} 行：${line.trim()}）`)
    }
  })
  return hits
}

test('G2 导入锁：全部桌面工程（含 servers）的 build.js / dev-host.js 零平台仓引用', () => {
  const files = buildChainFiles()
  assert.ok(DESKTOP_PROJECTS.length > 0, '工程清单不得为空（否则本锁空转）')
  assert.equal(files.length, DESKTOP_PROJECTS.length * 2 + 2, '文件清单数量与工程数不符')
  const offendersByFile = files
    .map((rel) => [rel, offenders(readFileSync(join(APPS_ROOT, rel), 'utf-8'))])
    .filter(([, hits]) => hits.length > 0)
  assert.deepEqual(
    offendersByFile,
    [],
    `构建链仍引平台仓源码：\n${offendersByFile
      .map(([rel, hits]) => `${rel}\n${hits.join('\n')}`)
      .join('\n')}`,
  )
})

test('G2 导入锁：SDK 工具经包名导入（不是相对路径）', () => {
  for (const project of DESKTOP_PROJECTS) {
    const src = readFileSync(desktopBuildJs(project), 'utf-8')
    assert.match(
      src,
      /from '@binblink\/wasmnest-plugin-sdk-desktop\/bin\/wasm-hash\.js'/,
      `${project.rel} 的 injectWasmHash 必须从 SDK 包导入`,
    )
    if (project.slug === 'bedcode') continue // bedcode 无前端 watch（既有口径），不引 plugin-watch
    assert.match(
      src,
      /from '@binblink\/wasmnest-plugin-sdk-desktop\/bin\/plugin-watch\.js'/,
      `${project.rel} 的 startPluginWatch 必须从 SDK 包导入`,
    )
  }
})

test('G2 导入锁：默认产物目录写各自工程 .build/plugins，且不复用 vite outDir', () => {
  for (const project of DESKTOP_PROJECTS) {
    const src = readFileSync(desktopBuildJs(project), 'utf-8')
    assert.match(src, /const DEFAULT_PLUGINS_DIR = join\('\.build', 'plugins'\)/)
    assert.match(src, /const PLUGINS_DIR = resolve\(ROOT, OUT_DIR_ARG \|\| DEFAULT_PLUGINS_DIR\)/)
    assert.doesNotMatch(src, /desktopHostResourcesDir\(\)/)
  }
})

test('G2 导入锁：仅前端构建先保全 wasm（否则清空 outDir 后无处复用）', () => {
  for (const project of DESKTOP_PROJECTS) {
    const src = readFileSync(desktopBuildJs(project), 'utf-8')
    assert.match(src, /function preservePreviousWasm\(\)/, `${project.rel} 缺构建前保全函数`)
    assert.match(src, /keptWasm/, `${project.rel} 的 copyArtifacts 未接保全结果`)
    const keptCall = src.indexOf('preservePreviousWasm()')
    const buildCall = src.indexOf('buildFrontend()')
    assert.ok(keptCall > -1 && buildCall > -1, `${project.rel} 缺少保全 / 构建调用点`)
  }
})

test('反例：含平台仓 import 的源码必须被本锁点名（防空转）', () => {
  const bad = `import { desktopHostResourcesDir } from '../../../../scripts/platform-paths.mjs'\n`
  const hits = offenders(bad)
  assert.ok(hits.length >= 1, '伪造的红必须被抓住，否则锁是空转')
  assert.match(hits[0], /platform-paths/)
  assert.deepEqual(offenders("import { join } from 'node:path'\n"), [])
})

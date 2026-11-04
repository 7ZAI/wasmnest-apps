/**
 * i18n 消息预编译锁（应用仓静态测试）
 *
 * 契约来源：2026-11-02 安全审查 #50（P2-3）——双端 CSP 撤掉 `'unsafe-eval'` 的前提
 * 是前端 i18n 消息在构建期预编译，运行期不再有 vue-i18n 消息编译器
 * （`new Function('return ' + code)`）。
 *
 * 本测试守三件事：
 * 1. 预编译插件对「带类型注解 + 具名导出」的消息模块有效，产物不含 `Function(`；
 * 2. 预编译后的消息函数语义正确（插值 / 纯文本），不是把字符串原样搬过去；
 * 3. 每个前端工程都接上了插件，桌面/服务型工程同时丢弃消息编译器——
 *    新增工程或改构建配置时漏接线，这里先红（而不是等真机上 i18n 全量报错）。
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { APPS_ROOT, listProjects } from '../lib/projects.mjs'
import { i18nPrecompile } from '../lib/i18n-precompile.mjs'

/** 本次测试创建的临时工程目录（结束时统一清理） */
const tmpdirs = []

after(() => {
  for (const dir of tmpdirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 忽略：临时目录清理失败不影响判据 */
    }
  }
})

/** 建一个临时工程目录，写入文件并返回 { root, plugin }；include 缺省 = 全部文件 */
function makeProject(files, include = Object.keys(files)) {
  const root = mkdtempSync(join(tmpdir(), 'wasmnest-i18n-'))
  tmpdirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  const plugin = i18nPrecompile({ include })
  plugin.configResolved({ root, command: 'build' })
  return { root, plugin }
}

function transform(project, rel) {
  const abs = join(project.root, rel)
  return project.plugin.transform(readFileSync(abs, 'utf8'), abs)
}

test('预编译：类型注解 + 具名导出的消息模块可编译，产物不含 eval', () => {
  const project = makeProject(
    {
      'zh-CN.ts': [
        "import type { Schema } from './messages'",
        'const zh: Schema = { greeting: "你好 {name}" }',
        'export default zh',
        'export const extra = { hint: "纯文本" }',
      ].join('\n'),
      'messages.ts': 'export interface Schema { [key: string]: string }',
    },
    ['zh-CN.ts'],
  )

  const result = transform(project, 'zh-CN.ts')
  assert.ok(result, '命中的消息模块必须被转换')
  assert.match(result.code, /export default \{/)
  assert.match(result.code, /export const extra = \{/)
  assert.ok(!result.code.includes('Function('), '预编译产物不得含 Function( / eval')
  assert.ok(!result.code.includes('new Function'), '预编译产物不得含 new Function')

  // 未命中清单的文件不处理
  assert.equal(transform(project, 'messages.ts'), null)
})

test('预编译：消息函数插值与纯文本语义正确', async () => {
  const project = makeProject({
    'en.ts':
      'const en: Record<string, string> = { hello: "hi {name}", plain: "no vars" }\nexport default en',
  })
  const { code } = transform(project, 'en.ts')

  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const messages = mod.default
  assert.equal(
    typeof messages.hello,
    'function',
    '消息叶子必须编译成函数（否则运行期仍会走编译器）',
  )

  const ctx = {
    normalize: (parts) => parts.join(''),
    interpolate: (value) => String(value),
    named: (key) => (key === 'name' ? '世界' : key),
    list: (index) => index,
    linked: (_key, value) => value,
    plural: (value) => value,
  }
  assert.equal(messages.hello(ctx), 'hi 世界')
  assert.equal(messages.plain(ctx), 'no vars')
})

test('预编译：非纯数据导出 fail-visible（不静默退回运行期编译）', () => {
  const project = makeProject({
    'bad.ts': 'export const messages = { a: "x" }\nexport const helper = () => 1',
  })
  assert.throws(() => transform(project, 'bad.ts'), /不是消息表或字符串/)
})

test('预编译：被导入的消息模块变更后重新求值（不吃旧缓存）', () => {
  const project = makeProject(
    {
      'zh-CN.ts': "import { extra } from './extra'\nexport default { hello: extra }",
      'extra.ts': "export const extra = 'one'",
    },
    ['zh-CN.ts'],
  )
  const first = transform(project, 'zh-CN.ts')
  assert.match(first.code, /one/)

  // 消息模块自身源码未变，但被导入模块变了：dev 下必须重新求值
  writeFileSync(join(project.root, 'extra.ts'), "export const extra = 'two'")
  const second = transform(project, 'zh-CN.ts')
  assert.match(second.code, /two/, '依赖模块变了，预编译产物必须重新求值')
})

test('接线锁：所有前端工程的 vite 配置都接上预编译，桌面/服务型还须丢弃消息编译器', () => {
  const projects = listProjects({ ends: ['desktop', 'mobile'] })
  assert.ok(projects.length >= 9, '工程清单异常：至少应有 6 个 app 端 + 3 个服务型端')

  for (const project of projects) {
    const configPath = join(APPS_ROOT, project.rel, 'vite.config.ts')
    const config = readFileSync(configPath, 'utf8')

    assert.match(
      config,
      /i18nPrecompile\(/,
      `${project.rel} 未接 i18nPrecompile：CSP 撤 'unsafe-eval' 后该端 i18n 会在运行期报错`,
    )

    // 桌面 / 服务型前端自持 i18n 实例并自带 vue-i18n → 必须丢弃消息编译器；
    // 移动端 vue-i18n 由宿主提供（外置），由平台仓宿主构建负责。
    if (project.rel.endsWith('/desktop')) {
      assert.match(
        config,
        /__INTLIFY_DROP_MESSAGE_COMPILER__\s*:\s*true/,
        `${project.rel} 未定义 __INTLIFY_DROP_MESSAGE_COMPILER__：消息编译器仍会被打进产物`,
      )
      assert.match(
        config,
        /vue-i18n\/dist\/vue-i18n\.runtime\.esm-bundler\.js/,
        `${project.rel} 未切到 vue-i18n 运行时构建`,
      )
    }
  }
})

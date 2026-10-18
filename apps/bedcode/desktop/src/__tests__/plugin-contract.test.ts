/**
 * com.wasmnest.terminal-session 工程契约测试（票 03；桌面宿主前端下沉后改写）
 *
 * 被测契约（全部是外部可见产物与边界，不测内部实现）：
 * - C1 身份一致：manifest.id / 构建脚本 PLUGIN_ID / manifest.rustLibrary /
 *   构建脚本 RUST_LIB_NAME / Cargo 包名与 crate-type 五处对齐——任一处改名而
 *   另一处未跟，宿主按目录绑定与库名解析即加载失败（票 06 改 id 时的护栏）
 * - C2 构建链收口：Rust 侧只经仓库共享配置取 target 与 pinned toolchain，
 *   脚本不得自带 `wasm32-wasip3` / `RUSTUP_TOOLCHAIN` 字面量（D2「沿用同一份配置」）
 * - C3 入口契约（下沉改写）：bootstrap 入口（main.ts）+ app 直连上下文形状 +
 *   静态路由表——取代旧「activate/deactivate + 贡献面注册」形态
 * - C4 退役锁（D8 fail-visible）：插件运行时回接 needle 零命中 +
 *   `plugin_invoke` 只经 app 命令通道 + `/plugins` `/shell` 路由不存在
 * - C5 静态侧边栏菜单表与设置分组表（D3/D4）：路由/顺序/文案 key 单表断言
 * - C6 前端调用面与后端/文案同源：命令分派臂、文案 key（宿主机制 + app 域
 *   两个消息集）、旧命令 id 不残留
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import router from '@/router'
import { messages } from '@/i18n'
import hostZhCN from '@/i18n/host-zh-CN'
import hostEn from '@/i18n/host-en'
import { createAppContext } from '@/appContext'
import { sidebarMenuItems, MENU_ORDERS } from '@/composables/useSidebarMenu'
import { settingsSections, SECTION_ORDERS } from '@/composables/useSettingsSections'

// happy-dom 下 import.meta.url 不是 file: 协议，无法 fileURLToPath；
// vitest 以 app 工程根为 cwd（独立 vitest.config.ts），PLUGIN_ROOT = cwd
const PLUGIN_ROOT = resolve(process.cwd())
const manifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'plugin.json'), 'utf-8'))
const buildScript = readFileSync(resolve(PLUGIN_ROOT, 'scripts/build.js'), 'utf-8')
const cargoToml = readFileSync(resolve(PLUGIN_ROOT, 'rust/Cargo.toml'), 'utf-8')

/** 剔除注释后的代码正文（needle 只约束可执行代码——注释里说明「旧机制已退役」是合法文档） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 前端源码清单（排除测试自身；代码正文剔除注释，避免断言里的正则字面量自匹配） */
function frontendSources(): { file: string; code: string }[] {
  const srcDir = resolve(PLUGIN_ROOT, 'src')
  return readdirSync(srcDir, { recursive: true })
    .map((p) => String(p))
    .filter((p) => /\.(ts|vue)$/.test(p) && !p.includes('__tests__'))
    .map((p) => ({ file: p, code: stripComments(readFileSync(join(srcDir, p), 'utf-8')) }))
}

/** 消息树全部叶子 key（宿主机制文案 + app 域消息两个集合的并集） */
function flattenKeys(node: unknown, prefix: string, out: Set<string>): void {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      flattenKeys(value, prefix ? `${prefix}.${key}` : key, out)
    }
  } else if (prefix) {
    out.add(prefix)
  }
}

const DECLARED_MESSAGE_KEYS = new Set<string>()
flattenKeys(messages['zh-CN'], '', DECLARED_MESSAGE_KEYS)
flattenKeys(hostZhCN, '', DECLARED_MESSAGE_KEYS)

describe('C1 工程身份五处一致', () => {
  it('manifest id 与构建脚本 PLUGIN_ID、内置资源目录条目一致', () => {
    expect(manifest.id).toBe('com.wasmnest.terminal-session')
    expect(buildScript).toContain(`const PLUGIN_ID = 'com.wasmnest.terminal-session'`)
    // 内置资源产物目录约定：平台仓宿主 src-tauri/resources/plugins/desktop/<plugin-id>/。
    // 三仓拆分 §5-E7：路径经 `desktopHostResourcesDir()`（platform-paths resolver）解析，
    // 不再在 app build.js 里拼 `../../src-tauri/...` 相对路径。
    expect(buildScript).toContain('resolve(desktopHostResourcesDir(), PLUGIN_ID)')
  })

  it('rustLibrary 与构建脚本 RUST_LIB_NAME 与 Cargo 包名一致', () => {
    expect(manifest.rustLibrary).toBe('bedcode_plugin_terminal_session')
    expect(buildScript).toContain(`const RUST_LIB_NAME = 'bedcode_plugin_terminal_session'`)
    expect(cargoToml).toContain('name = "bedcode-plugin-terminal-session"')
  })

  it('产物形态：rust-ts + cdylib（wasip3 直出 Component），sandbox 字段已退役', () => {
    expect(manifest.pluginType).toBe('rust-ts')
    // `sandbox` 已退役（审计票 06 裁决 2）：前端不做隔离，安全边界只在 Rust 端与 WASM 端。
    // 产物 manifest 不得再声明它——否则等于把「沙箱模式」重新写成安全承诺
    expect('sandbox' in manifest).toBe(false)
    // main 字段：宿主前端整体下沉后 lib 产物（dist/index.js）在桌面端退役（D2），
    // 该字段是 manifest schema 必填位的遗留值（Rust 侧不消费前端产物），保留不改
    expect(manifest.main).toBe('index.js')
    expect(cargoToml).toContain('crate-type = ["cdylib"]')
  })

  it('权限与 api/commands 声明面（八域权限 + 廿九项 api + 任务域命令族）', () => {
    // 权限清单与 D2 能力映射一一对应（auth / peer / storage / connection:read /
    // session:read / pty:* / ui:* / broadcast / fs:* / network:http / process:run /
    // task:run / terminal:input / timer:schedule / ws:server）。
    // 清单按 manifest-gen 的排序口径（ASCII 升序）落定：release 构建路径会重排，
    // 人工写成别的顺序即「构建一次即 git dirty」的漂移。
    expect(manifest.permissions).toEqual([
      'auth',
      'broadcast',
      'connection:read',
      'fs:read',
      'fs:write',
      'network:http',
      'peer',
      'process:run',
      // 排序形态 = manifest-gen 的 `[...permissions].sort()`（生成物口径）：
      // pty:io 必在 pty:spawn 前，重建产物即归一
      'pty:io',
      'pty:spawn',
      'session:read',
      'storage',
      'task:run',
      'terminal:input',
      'timer:schedule',
      'ui:input',
      'ui:settings',
      'ui:sidebar',
      'ws:server',
    ])
    expect(manifest.api).toEqual([
      'com.wasmnest.terminal-session.pairing-code-generate',
      'com.wasmnest.terminal-session.pairing-code-status',
      'com.wasmnest.terminal-session.pairing-code-verify',
      'com.wasmnest.terminal-session.pairing-code-clear',
      'com.wasmnest.terminal-session.qr-code-generate',
      'com.wasmnest.terminal-session.qr-code-status',
      'com.wasmnest.terminal-session.qr-code-verify',
      'com.wasmnest.terminal-session.qr-code-clear',
      'com.wasmnest.terminal-session.trust-list',
      'com.wasmnest.terminal-session.trust-revoke',
      'com.wasmnest.terminal-session.consent-decide',
      'com.wasmnest.terminal-session.config-list',
      'com.wasmnest.terminal-session.config-upsert',
      'com.wasmnest.terminal-session.config-delete',
      'com.wasmnest.terminal-session.quick-actions-import',
      'com.wasmnest.terminal-session.auth-records-import',
      'com.wasmnest.terminal-session.devices-list',
      'com.wasmnest.terminal-session.history-list',
      'com.wasmnest.terminal-session.connection-touch',
      'com.wasmnest.terminal-session.connection-close',
      // v32（ADR 0031）：组合式认证原语 `auth-method-invoke` 的转发目标——宿主
      // `invoke_auth_method` 按 `format!("{}.auth-grant", center_owner)` 组装请求 topic，
      // 「未声明 api 不可调」门禁会直接拒掉它。**必须**在此声明，否则其他插件的
      // 组合式认证调用会在总线门禁处静默失败（无声明 = 没有 API 面）
      'com.wasmnest.terminal-session.auth-grant',
      'com.wasmnest.terminal-session.session-create',
      'com.wasmnest.terminal-session.session-restart',
      'com.wasmnest.terminal-session.session-remove',
      'com.wasmnest.terminal-session.session-rename',
      'com.wasmnest.terminal-session.session-resize',
      'com.wasmnest.terminal-session.annotate',
      'com.wasmnest.terminal-session.devices-connect-list',
      // 会话引擎下沉 P1：登记域读取面（宿主窄转发层真源切换时的取数口，形状 = SessionInfoView）
      'com.wasmnest.terminal-session.session-list',
      'com.wasmnest.terminal-session.session-get',
      // 会话引擎下沉 P1-b：停止（登记 Stopping + host-pty.kill）与输入写入
      'com.wasmnest.terminal-session.session-close',
      'com.wasmnest.terminal-session.session-input',
      // 票 08（websocket 业务下沉）：一次性历史快照（宿主不再直读会话输出环）
      'com.wasmnest.terminal-session.session-history',
      // 票 09b：WS 会话控制词表分派（宿主 /ws/event SessionControl 的声明式路由接线）
      'com.wasmnest.terminal-session.session-ws-control',
    ])
    // 桥接锚点：宿主 auth_center 以 trust-list 探活（配对 / trust / policy 同一桥接门），
    // 改名即两侧失联（永久静默降级）
    expect(manifest.api).toContain('com.wasmnest.terminal-session.trust-list')
    // 消费方契约：file-transfer 经互调消费这两条（未声明 api 不可调，缺一即整片被拒）
    expect(manifest.api).toContain('com.wasmnest.terminal-session.consent-decide')
    // manifest.api 与 Rust trait 的 `#[api(...)]` 声明同源（宏在编译期比对，
    // 此处守「源码在但清单漏项」这一侧，避免宿主按旧清单调用）
    const apiDeclarations = readFileSync(resolve(PLUGIN_ROOT, 'rust/src/lib.rs'), 'utf-8')
    for (const api of manifest.api as string[]) {
      const short = api.replace('com.wasmnest.terminal-session.', '')
      expect(apiDeclarations, `trait 缺 #[api("${short}")]`).toContain(`#[api("${short}")]`)
    }
    // 命令面声明与后端 dispatch 分支同源（缺 declaration 的命名）
    expect(manifest.contributes.commands.map((c: { id: string }) => c.id)).toEqual([
      'session.status',
      'session.task.scheduler-tick',
      'session.task.cleanup-project-hooks',
      'session.task.get-status',
      'session.task.history-list',
      'session.task.history-stats',
      'session.task.running-sessions',
      'session.task.set-platform',
      'session.task.set-auto-mode',
      'session.task.session-settings',
      'session.task.supported-agents',
      'session.task.session-configs',
      'session.task.preset-list',
      'session.task.preset-create',
      'session.task.preset-delete',
      'session.task.preset-update',
      'session.task.preset-enqueue',
      'session.task.queue-list',
      'session.task.queue-add',
      'session.task.queue-cancel',
      'session.task.queue-remove',
      'session.task.queue-clear',
      'session.task.queue-update',
      'session.task.queue-reorder',
      // 票 16：定时任务域（scheduled）四条
      'session.task.scheduled-list',
      'session.task.scheduled-create',
      'session.task.scheduled-delete',
      'session.task.scheduled-reset',
    ])
    // ABI v29（HTTP 路由代码注册下沉）：manifest `contributes.httpEndpoints` 静态声明面
    // 已退役（用户裁定 ④：不通过声明配置路由，插件代码运行时注册）。
    // 新单一事实源 = `rust/src/http_routes.rs` 的 ROUTES 表（内部端点段 + host 别名 +
    // 档位；宿主侧契约由 http_routes.rs 自身测试锁：自洽 / none 档可交代 / 别名与旧
    // 网关表逐字一致）。此处守「退役面不得复燃 + 分派源在 Rust」两侧。
    expect(manifest.contributes.httpEndpoints).toBeUndefined()
    const httpRoutesSource = readFileSync(resolve(PLUGIN_ROOT, 'rust/src/http_routes.rs'), 'utf-8')
    expect(httpRoutesSource).toContain('pub const ROUTES: &[HttpRouteDecl]')
    // ROUTES 表必须覆盖旧静态清单的全部 34 个内部段（业务 10 + 认证 7 + 任务 17），
    // 并新增 sessions REST 7 + terminal-bg 1（票 11 下沉收尾）
    for (const endpoint of [
      'configs',
      'quick-actions',
      'file-tree',
      'file-tree-children',
      'file-content',
      'diff-tree',
      'file-diff',
      'git/branches',
      'git/status',
      'git/checkout',
      'auth/pairing',
      'auth/verify',
      'auth/qr-connect',
      'auth/reauth',
      'auth/biometric-challenge',
      'auth/biometric-verify',
      'auth/biometric-bind',
      'task-status',
      'session-mode',
      'session-settings',
      'task-history/current',
      'task-history/list',
      'supported-agents',
      'task-queue/add',
      'task-queue/remove',
      'task-queue/list',
      'task-queue/clear',
      'task-queue/update',
      'task-queue/reorder',
      'task-queue/cancel',
      'scheduled-jobs/create',
      'scheduled-jobs/list',
      'scheduled-jobs/remove',
      'scheduled-jobs/reset',
    ]) {
      expect(httpRoutesSource, `http_routes::ROUTES 缺内部段 ${endpoint}`).toContain(`"${endpoint}"`)
    }
    // 免凭证档位（none）必须覆盖旧 NO_AUTH_HTTP_ENDPOINTS 九条 + terminal-bg（CSS 无凭证）
    for (const endpoint of [
      'auth/pairing',
      'auth/verify',
      'auth/qr-connect',
      'auth/reauth',
      'auth/biometric-challenge',
      'auth/biometric-verify',
      'auth/biometric-bind',
      'task-status',
      'session-mode',
      'terminal-bg',
    ]) {
      // 每条 none 档声明都要能在这份源码里找到（`"auth": NONE` 形态），否则即 401 漂移
      expect(httpRoutesSource).toContain(`"${endpoint}"`)
    }
    // sessions REST 模板别名与 terminal-bg 必须在册（移动端 URL 锚点）
    expect(httpRoutesSource).toContain('"/api/sessions"')
    expect(httpRoutesSource).toContain('"/api/sessions/{id}/stop"')
    expect(httpRoutesSource).toContain('"/static/terminal-bg"')
  })
})

describe('C2 构建链收口到共享配置', () => {
  /** 去注释后的脚本正文：护栏只约束可执行代码，注释里说明 target 名称不受限 */
  const buildCode = buildScript
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')

  it('从仓库共享配置引入 WASM_TARGET / wasip3CargoEnv', () => {
    // import 块内允许夹带其他共享配置项（如 WASM_TARGET_DIR），但必需的两个名字与
    // 「来自仓库单一真源」这两点不能变——2026-09-26 target 目录治理新增
    // WASM_TARGET_DIR，import 因此变多行且中间多一个名字，原先的相邻断言会误红
    expect(buildScript).toMatch(
      /import\s*\{[^}]*\bWASM_TARGET\b[^}]*\bwasip3CargoEnv\b[^}]*\}\s*from\s*'[^']*plugin-wasm-config\.mjs'/,
    )
    expect(buildCode).toContain('cargo build --target ${WASM_TARGET}')
  })

  it('产物落点也走共享配置（不写死 per-crate target 路径）', () => {
    // wasm 应用共享 target 目录：构建参数与产物路径都取自共享配置；脚本内不得出现
    // crate 根的 `rust/target/...` 字面量（否则绕开共享目录，重复编译依赖图）
    expect(buildScript).toMatch(/import\s*\{[^}]*\bWASM_TARGET_DIR\b[^}]*\}/)
    expect(buildCode).toContain('--target-dir ${WASM_TARGET_DIR}')
    expect(buildCode).not.toContain('rust/target/')
  })

  it('app 代码不自带 target 与 toolchain 字面量（漂移即红）', () => {
    expect(buildCode).not.toMatch(/wasm32-/)
    expect(buildCode).not.toContain('RUSTUP_TOOLCHAIN')
    expect(buildCode).not.toContain('nightly-')
  })
})

/** 测试用挂载环境（命令/存储经 mock 桩；页面注入契约逐字验证） */
function makeEnv(overrides: Partial<Parameters<typeof createAppContext>[0]> = {}) {
  return {
    appId: 'com.wasmnest.terminal-session',
    invoke: vi.fn(async () => ({ ui: { terminal_font_size: 14, terminal_letter_spacing: 0 } })),
    appInvoke: vi.fn(async () => ({})),
    appStorageGet: vi.fn(async () => undefined),
    appStorageSet: vi.fn(async () => {}),
    appStorageDelete: vi.fn(async () => {}),
    locale: 'zh-CN',
    theme: 'dark',
    initialRoute: '/sessions',
    ...overrides,
  }
}

describe('C3 入口契约（挂载包形态：mountApp + 直连上下文 + 内存路由）', () => {
  it('app 直连上下文提供与旧 PluginContext 同形的取数面', () => {
    const ctx = createAppContext(makeEnv()) as any
    expect(ctx.id).toBe('com.wasmnest.terminal-session')
    // 命令通道：execute 走 app 命令通道（无前端 handler 注册表）
    expect(typeof ctx.commands.execute).toBe('function')
    // i18n：t 自动补 com.wasmnest.terminal-session.* 命名空间（D5 静态化）
    expect(ctx.i18n.t('session.sidebar.title')).toBe('终端会话')
    expect(ctx.i18n.t('session.sidebar.title', {})).toBe('终端会话')
    // 宿主机制文案经顶层 key 直查（同一实例两个消息集）
    expect(ctx.i18n.getI18n().global.t('desktop.sidebar.settings')).toBe('设置')
    // 存储 / 事件 / 窗口原语四件在场
    expect(typeof ctx.storage.get).toBe('function')
    expect(typeof ctx.storage.set).toBe('function')
    expect(typeof ctx.events.on).toBe('function')
    expect(typeof ctx.session.openTerminal).toBe('function')
    expect(typeof ctx.session.closeTerminal).toBe('function')
    expect(typeof ctx.session.isTerminalOpen).toBe('function')
    expect(typeof ctx.session.predictTerminalSize).toBe('function')
    // 贡献面注册 / http 端点注册随插件运行时退役，不得提供
    expect(ctx.ui).toBeUndefined()
    expect(ctx.http).toBeUndefined()
  })

  it('静态路由表：菜单四项 + 诊断/深链页 + not-found 兜底（内存路由，宿主 history 归宿主）', () => {
    const routes = router.getRoutes()
    const byName = new Map(routes.map((r) => (r.name ? [r.name, r] : [null, r])))
    // 菜单页（D3 静态表）
    expect(byName.get('pairing')?.path).toBe('/pairing')
    expect(byName.get('sessions')?.path).toBe('/sessions')
    expect(byName.get('tasks')?.path).toBe('/tasks')
    expect(byName.get('settings')?.path).toBe('/settings')
    // 诊断页（URL 直达不进导航）
    expect(byName.get('server')?.path).toBe('/server')
    // 深链页
    expect(byName.get('history')?.path).toBe('/history')
    expect(byName.get('terminal-window')?.path).toBe('/terminal-window/:id')
    expect(byName.get('terminal-window')?.meta.bareWindow).toBe(true)
    // 默认落地 = 应用主面（/sessions；宿主 '/' 壳主屏由宿主路由表承载）
    const root = routes.find((r) => r.path === '/')
    expect(root?.redirect).toBe('/sessions')
    // 遗留深链：/settings/authorization 显性重定向到 /settings（授权管理归宿主 /sys/perms）
    expect(byName.get('settings-authorization-legacy')?.redirect).toBe('/settings')
    // not-found 兜底在位（D3 fail-visible）
    expect(byName.get('not-found')).toBeTruthy()
  })

  it('挂载入口（entry.ts）导出 mountApp 契约主干（宿主 useAppMount 装载）', () => {
    const entry = stripComments(readFileSync(resolve(PLUGIN_ROOT, 'src/entry.ts'), 'utf-8'))
    // 契约：export mountApp + unmount/setRoute/setLocale 句柄
    expect(entry).toContain('export async function mountApp(')
    expect(entry).toContain('app.provide(\'pluginContext\'')
    expect(entry).toContain('app.mount(root)')
    expect(entry).toContain('unmount()')
    expect(entry).toContain('setRoute(')
    // 旧插件生命周期导出 / 共享运行时全局不得残留
    expect(entry).not.toContain('pluginLoader')
    expect(entry).not.toContain('setupSharedRuntime')
    expect(entry).not.toContain('__WASMNEST_SHARED__')
    // 本包自带依赖（无外部化）——vite 构建不再依赖宿主全局
    expect(readFileSync(resolve(PLUGIN_ROOT, 'vite.config.ts'), 'utf-8')).not.toContain('wasmnestPlugin()')
  })
})

describe('C4 退役锁（D8 fail-visible：插件运行时回接零命中）', () => {
  /** D8 锁 1：插件运行时回接 needle（贡献面注册 / loader / 共享运行时全局） */
  const NEEDLES: { name: string; pattern: RegExp }[] = [
    { name: '宿主插件模块别名 @/plugin/', pattern: /@\/plugin\// },
    { name: 'pluginLoader', pattern: /pluginLoader/ },
    { name: 'registerSidebarPanel', pattern: /registerSidebarPanel/ },
    { name: 'registerPage', pattern: /registerPage\b/ },
    { name: 'registerSettingsSection', pattern: /registerSettingsSection/ },
    { name: 'registerTerminalToolbarItem', pattern: /registerTerminalToolbarItem/ },
    { name: '共享运行时全局 __WASMNEST_SHARED__', pattern: /__WASMNEST_SHARED__/ },
    { name: 'SDK getRouter（宿主共享 router 读取）', pattern: /getRouter/ },
  ]

  for (const needle of NEEDLES) {
    it(`源码零命中：${needle.name}`, () => {
      const hits = frontendSources()
        .filter((f) => needle.pattern.test(f.code))
        .map((f) => f.file)
      expect(hits, `回接插件运行时的文件: ${hits.join(', ')}`).toEqual([])
    })
  }

  it('plugin_invoke 不在 app 前端出现（命令通道经宿主 env.appInvoke 注入，app 零直调）', () => {
    const hits = frontendSources()
      .filter((f) => /plugin_invoke/.test(f.code))
      .map((f) => f.file)
    expect(hits, `app 前端直调 plugin_invoke 的文件（应经 env.appInvoke）: ${hits.join(', ')}`).toEqual([])
    // 防空转：env 适配层在场（appContext 的 commands.execute 走 env.appInvoke）
    const ctx = createAppContext(makeEnv() as any) as any
    expect(typeof ctx.commands.execute).toBe('function')
  })

  it('D8 锁 2：/plugins 与 /shell 路由不存在（退役面 fail-visible）', () => {
    for (const route of router.getRoutes()) {
      expect(route.path.startsWith('/plugins')).toBe(false)
      expect(route.path.startsWith('/shell')).toBe(false)
      expect(route.path.startsWith('/plugin/')).toBe(false)
    }
  })
})

describe('C5 静态侧边栏菜单表与设置分组表（D3/D4）', () => {
  it('侧边栏 = 静态表：四项、顺序槽位、路由与路由表一一对应', () => {
    expect(sidebarMenuItems.map((i) => i.id)).toEqual(['pairing', 'sessions', 'tasks', 'settings'])
    expect(sidebarMenuItems.map((i) => i.order)).toEqual([100, 200, 210, 9999])
    expect(sidebarMenuItems.map((i) => i.path)).toEqual([
      '/pairing',
      '/sessions',
      '/tasks',
      '/settings',
    ])
    // 槽位常量即表内 order（改常量不改表 = 漂移，锁同值）
    expect(MENU_ORDERS).toEqual({ pairing: 100, sessions: 200, tasks: 210, settings: 9999 })
    // 菜单路径全部命中路由表（静态表与静态路由互为真源）
    const paths = new Set(router.getRoutes().map((r) => r.path))
    for (const item of sidebarMenuItems) {
      expect(paths.has(item.path), `菜单 ${item.id} 的路由 ${item.path} 不在路由表`).toBe(true)
    }
    // app 域菜单项走命名空间 key，宿主机制项（设置）走顶层 key
    expect(sidebarMenuItems[0].labelKey).toBe('com.wasmnest.terminal-session.pairing.sidebar.title')
    expect(sidebarMenuItems[3].labelKey).toBe('desktop.sidebar.settings')
  })

  it('设置分组 = 静态表：业务两分组、order 升序、带标题 key（平台分组归宿主系统页）', () => {
    const sorted = [...settingsSections].sort((a, b) => a.order - b.order)
    expect(sorted.map((s) => s.key)).toEqual(['pairing', 'session'])
    expect(sorted.map((s) => s.order)).toEqual([200, 400])
    // 业务分组携带标题 key（仅正文组件，外壳由设置页统一渲染）
    expect(sorted[0].titleKey).toBe('com.wasmnest.terminal-session.pairing.settings.title')
    expect(sorted[1].titleKey).toBe('com.wasmnest.terminal-session.session.settings.title')
    expect(SECTION_ORDERS).toEqual({ pairing: 200, session: 400 })
  })
})

describe('C6 前端调用面与后端/文案同源（票 17）', () => {
  const rustDispatch = readFileSync(resolve(PLUGIN_ROOT, 'rust/src/lib.rs'), 'utf-8')
  /** Rust `invoke_command` 的匹配臂（含宿主桥接与调试臂，非仅 manifest 声明面） */
  const rustArms = new Set(
    [...rustDispatch.matchAll(/^\s{12}"([\w.-]+)"\s*=>/gm)].map((m) => m[1]),
  )

  it('前端调用的每条命令在 Rust 分派表里有同名臂（改名/漏臂即红）', () => {
    // 票 15/16 把 28 条任务命令从 `auto-task.*` 改指 `session.task.*`：调用点与
    // 后端臂只有一处跟上，现象是运行期「unknown command」，编译期抓不到
    expect(rustArms.size, 'Rust 分派臂解析失败（缩进约定变了要同步改本用例）').toBeGreaterThan(40)
    const called = new Set<string>()
    for (const { code } of frontendSources()) {
      for (const m of code.matchAll(/commands\.execute\(\s*'([\w.-]+)'/g)) called.add(m[1])
    }
    expect(called.size).toBeGreaterThan(20)
    const dangling = [...called].filter((id) => !rustArms.has(id))
    expect(dangling, `前端调用了后端不存在的命令: ${dangling.join(', ')}`).toEqual([])
  })

  it('前端 t() 用到的每个文案 key 都在两语言表里（宿主机制集 + app 域集）', () => {
    const used = new Set<string>()
    for (const { code } of frontendSources()) {
      for (const m of code.matchAll(/(?:^|[^A-Za-z0-9_.])t\('([\w.]+)'/g)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(100)
    const missing = [...used].filter((k) => !DECLARED_MESSAGE_KEYS.has(k))
    expect(missing, `调用了未登记的文案 key: ${missing.join(', ')}`).toEqual([])
  })

  it('宿主机制消息集双语键集逐字相等（随下沉迁入的同步校验）', () => {
    const zh = new Set<string>()
    const en = new Set<string>()
    flattenKeys(hostZhCN, '', zh)
    flattenKeys(hostEn, '', en)
    expect([...en].sort()).toEqual([...zh].sort())
  })

  it('任务域调用点不残留旧插件命令 id（票 17 退役判据）', () => {
    // 只扫字符串字面量：注释里被 import 替换掉的旧 auto-task 命令 id（搬迁出处留痕）允许存在；
    // 字面量里的旧命令 id 才是真断裂（后端已无该臂，运行期 unknown command）
    const hits = frontendSources()
      .filter((f) => /['"`]auto-task\.[\w-]+['"`]/.test(f.code))
      .map((f) => f.file)
    expect(hits, `仍引用旧命令 id: ${hits.join(', ')}`).toEqual([])
  })
})

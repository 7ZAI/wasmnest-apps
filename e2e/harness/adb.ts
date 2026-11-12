/**
 * adb 薄封装 —— 移动端 E2E 的设备生命周期层
 *
 * ## 为什么用 `spawn(args[])` 而不是 `exec("adb shell ...")`
 *
 * 设备命令里会出现包名 / 路径 / 输入文本（测试数据里可能有空格与中文）。走 shell 字符串
 * 需要自己做转义，一处漏转义就是命令注入或「引号被吞」型假失败；统一传参数数组让 adb
 * 自己拼装，失败时也能把**原始 argv** 打出来。
 *
 * ## 失败口径（fail-visible）
 *
 * 设备未连接 / 未授权 / 二进制缺失一律抛错并给出修复指引——移动端 E2E 的唯一驱动方式
 * 就是真机，静默 skip 会让整套用例在 CI 上变成「绿着的空跑」。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** adb 客户端：二进制路径 + 目标设备 serial（多设备时必须指定） */
export interface AdbClient {
  bin: string
  serial: string
}

/** 单条 adb 命令的默认预算（设备卡顿时安装 / 启动会慢，单独传入更长预算） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 解析 adb 二进制：优先 ANDROID_HOME / ANDROID_SDK_ROOT，其次 PATH */
export function resolveAdbBinary(): string {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (sdk) {
    const candidate = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (existsSync(candidate)) return candidate
  }
  return 'adb'
}

/** 执行一条 adb 命令，返回 stdout（stderr 只在失败时进错误信息） */
export function runAdb(
  client: AdbClient,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const argv = [...(client.serial ? ['-s', client.serial] : []), ...args]

  return new Promise((resolve, reject) => {
    const child = spawn(client.bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`adb 超时（${timeoutMs}ms）：${client.bin} ${argv.join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const hint =
        error.code === 'ENOENT'
          ? `\n  adb 不在 PATH：安装 Android platform-tools 或设置 ANDROID_HOME / ANDROID_SDK_ROOT`
          : ''
      reject(new Error(`启动 adb 失败：${error.message}${hint}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const out = Buffer.concat(stdout)
      const errText = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        reject(
          new Error(
            `adb 退出码 ${code}：${client.bin} ${argv.join(' ')}\n` +
              `  stderr: ${errText.slice(0, 2000) || '(empty)'}`,
          ),
        )
        return
      }
      resolve(out)
    })
  })
}

/** 执行设备内 shell 命令（返回 trim 后的文本） */
export async function adbShell(client: AdbClient, command: string, timeoutMs?: number): Promise<string> {
  const out = await runAdb(client, ['shell', command], { timeoutMs })
  return out.toString('utf8').trim()
}

/** 取二进制输出（`exec-out screencap -p` 这类不能经过文本解码的命令） */
export function adbExecOut(client: AdbClient, args: string[], timeoutMs?: number): Promise<Buffer> {
  return runAdb(client, ['exec-out', ...args], { timeoutMs })
}

export interface AdbDevice {
  serial: string
  state: string
}

/** 列出设备（`adb devices` 的第一行是表头） */
export async function listDevices(client: Pick<AdbClient, 'bin'>): Promise<AdbDevice[]> {
  const out = await runAdb({ bin: client.bin, serial: '' }, ['devices'])
  const lines = out.toString('utf8').split(/\r?\n/)
  const devices: AdbDevice[] = []
  for (const line of lines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [serial, state] = trimmed.split(/\s+/)
    if (serial && state) devices.push({ serial, state })
  }
  return devices
}

/**
 * 解析目标设备 serial
 *
 * 优先级：显式 serial（`ANDROID_SERIAL` / `--serial`）> 唯一在线设备。
 * 多设备且未指定时**直接失败**——猜错设备会把用例跑到别人手机上。
 */
export async function pickSerial(bin: string, explicit?: string): Promise<string> {
  const devices = await listDevices({ bin })
  if (explicit) {
    const hit = devices.find((d) => d.serial === explicit)
    if (!hit) {
      throw new Error(`指定的设备不在线：${explicit}；当前设备：${JSON.stringify(devices)}`)
    }
    if (hit.state !== 'device') {
      throw new Error(`设备 ${explicit} 状态为 ${hit.state}（需要 device；unauthorized 请在手机上确认调试授权）`)
    }
    return explicit
  }

  const online = devices.filter((d) => d.state === 'device')
  if (online.length === 0) {
    const detail = devices.length > 0 ? `当前设备：${JSON.stringify(devices)}` : 'adb devices 为空'
    throw new Error(
      `没有可用的真机（${detail}）。\n` +
        '  移动端 E2E 必须连真机：USB 连接 → 开发者选项开启 USB 调试 → 手机上确认授权。',
    )
  }
  if (online.length > 1) {
    throw new Error(
      `检测到多台在线设备（${online.map((d) => d.serial).join(', ')}）：请用 --serial 或 ANDROID_SERIAL 指定。`,
    )
  }
  return online[0]!.serial
}

/** 进程 pid（未运行返回 null） */
export async function pidOf(client: AdbClient, packageName: string): Promise<number | null> {
  const out = await adbShell(client, `pidof ${packageName}`)
  const pid = Number(out.split(/\s+/)[0])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/**
 * WebView 调试套接字名（`webview_devtools_remote_<pid>`）
 *
 * 优先匹配应用自身 pid 的套接字；同名前缀可能有多个（系统 WebView 进程 / 其他应用），
 * 不按 pid 过滤会把 CDP 连到别的页面。
 */
export async function devtoolsSocket(client: AdbClient, pid: number): Promise<string | null> {
  const out = await adbShell(client, 'cat /proc/net/unix')
  const names = [...out.matchAll(/webview_devtools_remote_(\d+)/g)].map((m) => ({
    pid: Number(m[1]),
    name: `webview_devtools_remote_${m[1]}`,
  }))
  const hit = names.find((n) => n.pid === pid) ?? names[0]
  return hit?.name ?? null
}

export async function installApk(client: AdbClient, apkPath: string): Promise<void> {
  await runAdb(client, ['install', '-r', '-t', apkPath], { timeoutMs: 300_000 })
}

/** 清空应用数据（会话凭据 / 历史 / 插件抽取目录全部回到首启态） */
export async function clearAppData(client: AdbClient, packageName: string): Promise<void> {
  await adbShell(client, `pm clear ${packageName}`)
}

export async function forceStop(client: AdbClient, packageName: string): Promise<void> {
  await adbShell(client, `am force-stop ${packageName}`)
}

/** 冷启动到指定 Activity（`-S` 先杀掉旧进程，避免复用上一轮的页面状态） */
export async function startActivity(client: AdbClient, component: string): Promise<void> {
  const out = await adbShell(client, `am start -W -S -n ${component}`, 60_000)
  if (/Error|does not exist|Exception/i.test(out)) {
    throw new Error(`启动 Activity 失败：${component}\n${out}`)
  }
}

export async function forwardTcp(client: AdbClient, localPort: number, remote: string): Promise<void> {
  await runAdb(client, ['forward', `tcp:${localPort}`, remote])
}

export async function removeForward(client: AdbClient, localPort: number): Promise<void> {
  await runAdb(client, ['forward', '--remove', `tcp:${localPort}`]).catch(() => undefined)
}

/** 设备侧的 127.0.0.1:port → 宿主侧 127.0.0.1:port（USB 真机不用同网段） */
export async function reverseTcp(client: AdbClient, port: number): Promise<void> {
  await runAdb(client, ['reverse', `tcp:${port}`, `tcp:${port}`])
}

export async function removeReverseTcp(client: AdbClient, port: number): Promise<void> {
  await runAdb(client, ['reverse', '--remove', `tcp:${port}`]).catch(() => undefined)
}

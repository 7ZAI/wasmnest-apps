/**
 * relay 部署文本生成契约（T14）
 *
 * 判据：
 * - D1 三种形态（Compose / Docker run / systemd）都来自 T13 交付物的真实命令，
 *   替换项只有对外域名、端口、镜像版本；
 * - D2 生成文本不含任何凭据（enrollment token 只在服务器侧单独生成）；
 * - D3 非法输入（域名/端口/标签）显性拒绝，不产出半截命令；
 * - D4 非默认端口在 systemd 形态下给同步修改配置的提示（脚本固定 4001）。
 */

import { describe, it, expect } from 'vitest'
import {
  RELAY_DEFAULT_PORT,
  RELAY_DEFAULT_VERSION,
  RELAY_IMAGE_REPO,
  buildComposeText,
  buildDockerText,
  buildRelayDeployText,
  buildSystemdText,
  validateAdvertiseHost,
  validateRelayVersion,
} from '@/relay/relayDeploy'

const INPUT = { advertise: 'relay.example.com', port: 4001, version: RELAY_DEFAULT_VERSION }

function expectOk(result: ReturnType<typeof buildComposeText>): string {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.errorKey)
  return result.text
}

describe('部署输入校验', () => {
  it('对外主机接受域名 / IPv4 / IPv6，拒绝路径与空格', () => {
    expect(validateAdvertiseHost('relay.example.com')).toBe(true)
    expect(validateAdvertiseHost('203.0.113.10')).toBe(true)
    expect(validateAdvertiseHost('2001:db8::1')).toBe(true)
    expect(validateAdvertiseHost('relay.example.com/path')).toBe(false)
    expect(validateAdvertiseHost('relay example.com')).toBe(false)
    expect(validateAdvertiseHost('')).toBe(false)
  })

  it('镜像标签只接受 Docker tag 字符', () => {
    expect(validateRelayVersion('0.0.1')).toBe(true)
    expect(validateRelayVersion('0.0.1-rc.1')).toBe(true)
    expect(validateRelayVersion('bad tag')).toBe(false)
    expect(validateRelayVersion('-bad')).toBe(false)
  })

  it('非法输入不产出文本（失败可见）', () => {
    expect(buildComposeText({ ...INPUT, advertise: '/bad' })).toEqual({
      ok: false,
      errorKey: 'relay.deploy.invalidAdvertise',
    })
    expect(buildComposeText({ ...INPUT, port: 0 })).toEqual({
      ok: false,
      errorKey: 'relay.deploy.invalidPort',
    })
    expect(buildComposeText({ ...INPUT, version: 'x y' })).toEqual({
      ok: false,
      errorKey: 'relay.deploy.invalidTag',
    })
  })
})

describe('Compose 形态', () => {
  const text = expectOk(buildComposeText({ ...INPUT, port: 4100, version: '0.2.0' }))

  it('镜像 / 端口 / 初始化域名全部替换到位', () => {
    expect(text).toContain(`image: ${RELAY_IMAGE_REPO}:0.2.0`)
    expect(text).toContain('"4100:4001/tcp"')
    expect(text).toContain(
      'docker compose run --rm relay init --dir /data --advertise relay.example.com',
    )
    expect(text).toContain('docker compose exec relay wasmnest-relay print-addrs')
    // 健康检查与配额默认值来自 T13 compose
    expect(text).toContain('http://127.0.0.1:9090/healthz')
    expect(text).toContain('no-new-privileges:true')
    expect(text).toContain('relay-data:/data')
  })

  it('不含任何凭据字段', () => {
    expect(text.toLowerCase()).not.toContain('token=')
    expect(text.toLowerCase()).not.toContain('enrollment token')
  })
})

describe('Docker run 形态', () => {
  const text = expectOk(buildDockerText(INPUT))

  it('按 T13 README 的 init → run → print-addrs 顺序生成', () => {
    const init = text.indexOf('init --dir /data --advertise relay.example.com')
    const run = text.indexOf('docker run -d --name wasmnest-relay')
    const addrs = text.indexOf('print-addrs --config /data/config.toml --json')
    expect(init).toBeGreaterThan(-1)
    expect(run).toBeGreaterThan(init)
    expect(addrs).toBeGreaterThan(run)
    expect(text).toContain(`-p ${RELAY_DEFAULT_PORT}:4001/tcp`)
    expect(text).toContain(`-v wasmnest-relay-data:/data`)
  })
})

describe('systemd 形态', () => {
  it('install.sh 带 advertise；默认端口不额外提示', () => {
    const text = expectOk(buildSystemdText(INPUT))
    expect(text).toContain('./install.sh --advertise relay.example.com --binary ./wasmnest-relay')
    expect(text).toContain('wasmnest-relay doctor --config /etc/wasmnest-relay/config.toml')
    expect(text).not.toContain('需同步编辑')
  })

  it('非默认端口提示同步修改配置（脚本与 unit 固定 4001）', () => {
    const text = expectOk(buildSystemdText({ ...INPUT, port: 4100 }))
    expect(text).toContain('你选择了 4100')
    expect(text).toContain('/etc/wasmnest-relay/config.toml')
    expect(text).toContain('systemctl restart wasmnest-relay')
  })
})

describe('形态分发', () => {
  it('三种形态各自返回对应文本', () => {
    expect(expectOk(buildRelayDeployText('compose', INPUT))).toContain('Docker Compose')
    expect(expectOk(buildRelayDeployText('docker', INPUT))).toContain('Docker 单命令')
    expect(expectOk(buildRelayDeployText('systemd', INPUT))).toContain('systemd 单文件二进制')
  })
})

/**
 * 组件化工具定位与物化（G2 构建自足）
 *
 * 契约：工具随 npm SDK 发布（`tools/componentize/`），构建链**不引平台仓源码**；
 * 定位缺失 / 形态不完整都必须显性报错并给出路，不允许静默跳过组件化
 * （跳过 = 产出宿主装不上的 core module）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  resolveComponentizeManifest,
  stageComponentizeTool,
} from '../../scripts/sdk-componentize.mjs'

let dir: string
let pkgRoot: string
let sdkPackageJson: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ft-componentize-'))
  pkgRoot = join(dir, 'package')
  mkdirSync(join(pkgRoot, 'tools', 'componentize', 'src'), { recursive: true })
  mkdirSync(join(pkgRoot, 'src'), { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), '{"name":"@binblink/wasmnest-plugin-sdk-desktop"}')
  writeFileSync(
    join(pkgRoot, 'tools', 'componentize', 'Cargo.toml'),
    '[package]\nname = "wasmnest-componentize"\n',
  )
  writeFileSync(join(pkgRoot, 'tools', 'componentize', 'Cargo.lock'), '# lock\n')
  writeFileSync(join(pkgRoot, 'tools', 'componentize', 'src', 'main.rs'), 'fn main() {}\n')
  sdkPackageJson = join(pkgRoot, 'package.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveComponentizeManifest', () => {
  it('正例：经 SDK package.json 定位包内 tools/componentize/Cargo.toml', () => {
    expect(resolveComponentizeManifest(sdkPackageJson)).toBe(
      join(pkgRoot, 'tools', 'componentize', 'Cargo.toml'),
    )
  })

  it('反例：SDK 版本过旧（包内无工具）⇒ 报错点名修法，不返回可能无效的路径', () => {
    const missing = () => false
    expect(() => resolveComponentizeManifest(sdkPackageJson, missing)).toThrowError(
      /组件化工具缺失[\s\S]*link-platform-sdk/,
    )
  })
})

describe('stageComponentizeTool', () => {
  it('正例：物化到可写目录后 cargo 能拿到完整 crate（含 Cargo.lock）', () => {
    const dest = join(dir, 'work', 'componentize')
    const manifest = stageComponentizeTool(
      join(pkgRoot, 'tools', 'componentize', 'Cargo.toml'),
      dest,
    )
    expect(manifest).toBe(join(dest, 'Cargo.toml'))
    expect(readFileSync(join(dest, 'Cargo.lock'), 'utf-8')).toContain('# lock')
    expect(readFileSync(join(dest, 'src', 'main.rs'), 'utf-8')).toContain('fn main()')
  })

  it('反例：包内只有 Cargo.toml（发布物损坏）⇒ 显性报错', () => {
    rmSync(join(pkgRoot, 'tools', 'componentize', 'src'), { recursive: true })
    expect(() =>
      stageComponentizeTool(join(pkgRoot, 'tools', 'componentize', 'Cargo.toml'), join(dir, 'x')),
    ).toThrowError(/形态不完整/)
  })

  it('幂等：重复物化覆盖同名文件，不残留旧 src 内容', () => {
    const dest = join(dir, 'work2')
    stageComponentizeTool(join(pkgRoot, 'tools', 'componentize', 'Cargo.toml'), dest)
    writeFileSync(join(pkgRoot, 'tools', 'componentize', 'src', 'main.rs'), 'fn main() { // v2 }\n')
    stageComponentizeTool(join(pkgRoot, 'tools', 'componentize', 'Cargo.toml'), dest)
    expect(readFileSync(join(dest, 'src', 'main.rs'), 'utf-8')).toContain('v2')
    expect(existsSync(join(dest, 'Cargo.toml'))).toBe(true)
  })
})

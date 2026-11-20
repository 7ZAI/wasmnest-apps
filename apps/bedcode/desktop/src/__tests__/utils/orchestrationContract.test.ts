import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parsePlan,
  emptyPlan,
  emptyNode,
  splitCommandArgv,
  formatCommandArgv,
} from '@/utils/orchestrationPlan'

const fixturePath = join(process.cwd(), 'rust/fixtures/orchestration-plan.v2.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown

describe('orchestrationPlan（golden fixture 契约）', () => {
  it('金样计划按 TS wire 形状解析成功（与 Rust serde 同字段）', () => {
    const plan = parsePlan(fixture)
    expect(plan.version).toBe(2)
    expect(plan.nodes.map((node) => node.key)).toEqual(['n1', 'n2'])
    expect(plan.nodes[0].acceptance).toEqual({
      type: 'command',
      command: ['pnpm', 'run', 'test:run'],
      cwd: 'apps/file-transfer/desktop',
      timeoutSec: 900,
    })
    expect(plan.nodes[1].acceptance.type).toBe('verdict')
    expect(plan.nodes[1].dependsOn).toEqual(['n1'])
    expect(plan.nodes[0].agentRef).toBe('ap-frontend')
    expect(plan.nodes[0].agent?.cli).toBe('pi')
    expect(plan.nodes[0].matchReason).toContain('传输层')
  })

  it('缺字段 / 错类型显性报错，不静默补全', () => {
    expect(() => parsePlan({ version: 2 })).toThrow('nodes')
    expect(() =>
      parsePlan({
        version: 2,
        title: 't',
        goal: 'g',
        maxParallel: 1,
        nodes: [{ key: 'n1', title: 'x' }],
      }),
    ).toThrow()
  })

  it('空计划助手生成可编辑的合法形状', () => {
    const plan = emptyPlan('标题', '目标')
    expect(plan.nodes).toEqual([])
    expect(plan.maxParallel).toBe(2)
    const node = emptyNode('n1', 'ap-1')
    expect(node.acceptance).toEqual({ type: 'none' })
    expect(node.maxAttempts).toBe(1)
  })
})

describe('命令 argv 切分 / 格式化', () => {
  it('按空白切分；引号内空白保留为参数的一部分', () => {
    expect(splitCommandArgv('pnpm run test:run')).toEqual(['pnpm', 'run', 'test:run'])
    expect(splitCommandArgv('echo "hello world" \'a b\'')).toEqual(['echo', 'hello world', 'a b'])
    expect(splitCommandArgv('  \t ')).toEqual([])
  })

  it('转义与空参数', () => {
    expect(splitCommandArgv('echo ""')).toEqual(['echo', ''])
    expect(splitCommandArgv('echo "a\\"b"')).toEqual(['echo', 'a"b'])
    expect(splitCommandArgv('echo a\\ b')).toEqual(['echo', 'a b'])
    expect(splitCommandArgv("echo 'a\\b'")).toEqual(['echo', 'a\\b'])
  })

  it('未闭合引号不丢文本：剩余整体作为一个参数', () => {
    expect(splitCommandArgv('echo "unclosed')).toEqual(['echo', 'unclosed'])
  })

  it('格式化对含空白 / 引号 / 反斜杠的参数重新加引号', () => {
    expect(formatCommandArgv(['echo', 'hello world'])).toBe('echo "hello world"')
    expect(formatCommandArgv([''])).toBe('""')
    expect(formatCommandArgv(['a"b'])).toBe('"a\\"b"')
  })

  it('格式化 → 切分往返一致（编辑器回显不漂移）', () => {
    const samples = [
      ['echo', 'hello world'],
      ['a"b', 'c\\d'],
      ["it's", 'x y'],
      [''],
      ['pnpm', 'exec', 'vitest', 'run', '--grep', 'two words'],
    ]
    for (const argv of samples) {
      expect(splitCommandArgv(formatCommandArgv(argv))).toEqual(argv)
    }
  })
})

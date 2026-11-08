/**
 * useLinkCryptoStatus 行为契约（T07：固定 `required`，配置层拒绝关闭）
 *
 * - 唯一写入口 `enforce()` 无入参：写库值恒为 `required`（调用点拿不到 off / preferred）；
 * - `load()` 在能力齐备时把宿主旧值（off / preferred / 未知字面量）自动收紧；
 * - 不能真正生效时不写库：身份未初始化 / WS 帧加密未接线 / 旧宿主无能力；
 * - 写库失败保留「未生效」并留 `lastError`（显性，不假装已生效）。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  FORCED_ENCRYPTION_POLICY,
  useLinkCryptoStatus,
  type EncryptionPolicy,
  type LinkCryptoCapabilities,
} from '@/composables/useLinkCrypto'

function capabilities(overrides: Partial<LinkCryptoCapabilities> = {}): LinkCryptoCapabilities {
  return {
    appScopedPolicy: true,
    policies: ['required', 'preferred', 'off'],
    identityFingerprint: 'fingerprint-1',
    keyModels: ['paired-http-path-bound'],
    wsSession: true,
    ...overrides,
  }
}

interface HostOptions {
  policy?: unknown
  caps?: unknown
  writeFailures?: number
  omitBindings?: boolean
}

function makeHost(options: HostOptions = {}) {
  const state = { policy: (options.policy ?? 'off') as unknown, writes: [] as EncryptionPolicy[] }
  let remainingFailures = options.writeFailures ?? 0

  const invoke = vi.fn(async (command: string) => {
    if (command === 'get_link_crypto_capabilities') return options.caps ?? capabilities()
    throw new Error(`unexpected command: ${command}`)
  })

  const bindings: {
    getPolicy?: () => Promise<EncryptionPolicy>
    setPolicy?: (policy: EncryptionPolicy) => Promise<void>
  } = {}

  if (!options.omitBindings) {
    bindings.getPolicy = vi.fn(async () => state.policy as EncryptionPolicy)
    bindings.setPolicy = vi.fn(async (next: EncryptionPolicy) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error('persist failed')
      }
      state.writes.push(next)
      state.policy = next
    })
  }

  return { invoke, bindings, state }
}

describe('useLinkCryptoStatus — 固定 required', () => {
  it('固定档常量就是 wire 字面量 required', () => {
    expect(FORCED_ENCRYPTION_POLICY).toBe('required')
  })

  it('load：宿主记录 off → 自动收紧为 required 并标记 enforced', async () => {
    const { invoke, bindings, state } = makeHost({ policy: 'off' })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()

    expect(state.writes).toEqual(['required'])
    expect(status.policy.value).toBe('required')
    expect(status.supported.value).toBe(true)
    expect(status.blockReason.value).toBeNull()
    expect(status.enforced.value).toBe(true)
    expect(status.lastError.value).toBeNull()
  })

  it('load 幂等：第二次不再写库', async () => {
    const { invoke, bindings, state } = makeHost({ policy: 'preferred' })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()
    await status.load()

    expect(state.writes).toEqual(['required'])
  })

  it('未知策略字面量按 off 处理并收紧（不粉饰成已加密）', async () => {
    const { invoke, bindings, state } = makeHost({ policy: 'weird-value' })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()

    expect(state.writes).toEqual(['required'])
    expect(status.enforced.value).toBe(true)
  })

  it('写库失败：保留未生效与 lastError，不假装已强制', async () => {
    const { invoke, bindings, state } = makeHost({ policy: 'off', writeFailures: 1 })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()

    expect(state.writes).toEqual([])
    expect(status.policy.value).toBe('off')
    expect(status.enforced.value).toBe(false)
    expect(status.lastError.value).toContain('persist failed')
  })

  it('enforce：无入参，写库值恒为 required（多次调用同值）', async () => {
    const { invoke, bindings, state } = makeHost({ policy: 'off', writeFailures: 1 })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()
    await status.enforce()
    await status.enforce()

    expect(state.writes).toEqual(['required', 'required'])
    expect(status.policy.value).toBe('required')
    expect(status.enforced.value).toBe(true)
    expect(status.lastError.value).toBeNull()
  })

  it('链路身份未初始化：blockReason=identity-missing，不写库；enforce 抛错', async () => {
    const { invoke, bindings, state } = makeHost({
      policy: 'off',
      caps: capabilities({ identityFingerprint: null }),
    })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()

    expect(status.blockReason.value).toBe('identity-missing')
    expect(status.enforced.value).toBe(false)
    expect(state.writes).toEqual([])
    await expect(status.enforce()).rejects.toThrow('identity-missing')
    expect(state.writes).toEqual([])
  })

  it('旧宿主 WS 帧加密未接线：blockReason=ws-unsupported，不写库', async () => {
    const { invoke, bindings, state } = makeHost({
      policy: 'off',
      caps: capabilities({ wsSession: false }),
    })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()

    expect(status.blockReason.value).toBe('ws-unsupported')
    expect(status.enforced.value).toBe(false)
    expect(state.writes).toEqual([])
  })

  it('旧宿主无按应用策略面：supported=false，不写库；enforce 抛错', async () => {
    const { invoke, bindings, state } = makeHost({
      caps: capabilities({ appScopedPolicy: false }),
    })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()

    expect(status.supported.value).toBe(false)
    expect(status.enforced.value).toBe(false)
    expect(state.writes).toEqual([])
    await expect(status.enforce()).rejects.toThrow('unavailable')
    expect(state.writes).toEqual([])
  })

  it('旧宿主未注入 own-token 方法：supported=false，不写库', async () => {
    const { invoke, bindings, state } = makeHost({ omitBindings: true })
    const status = useLinkCryptoStatus(invoke, bindings)

    await status.load()

    expect(status.supported.value).toBe(false)
    expect(status.enforced.value).toBe(false)
    expect(state.writes).toEqual([])
  })
})

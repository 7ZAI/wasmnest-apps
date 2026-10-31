/**
 * Auth Center 桌面端 E2E —— 系统服务面
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app auth-center
 *
 * 判据纪律：
 * 1. 接入应用清单固定为 BedCode / File Transfer；单跑时两者为 missing，全量 staging
 *    会一起装载，运行态随宿主实际状态变化（断言取值域，不写死 missing）。
 * 2. 认证中心在 activate 末尾自行注册；页面状态三态之一。registered 时 owner 必须是
 *    本插件 id，not_ready / unknown 时必须有原因或错误，不冒充已就位。
 * 3. 不点「轮换密钥」：会持久改密钥代次，影响后续配对；只验证只读展示与刷新。
 */

import { browser } from '@wdio/globals'
import {
  attr,
  click,
  count,
  exists,
  text,
  visible,
  waitFor,
  waitForEnabled,
  waitForHostReady,
} from '../harness/driver'
import { expectEqual, expectInSet } from '../harness/expect'
import { goHome, homeAppCards, homeSystemCards, openSystemApp } from '../harness/shell'
import {
  APP_NAME,
  CONSUMER_BEDCODE,
  CONSUMER_FILE_TRANSFER,
  CONSUMERS,
  CONSUMERS_COUNT,
  CONSUMERS_ERROR,
  consumerRow,
  consumerState,
  consumerSurface,
  ERROR,
  KEYS,
  KEYS_KID,
  KEYS_PREVIOUS,
  KEYS_REFRESH,
  KEYS_ROTATE,
  METHODS,
  METHOD_IDS,
  methodId,
  PAGE,
  REFRESH,
  STATE,
  STATE_DOMAIN,
  STATUS,
  SYS_ENTRY_NAMES,
} from '../pages/authCenter'

/** 主屏服务宫格找到认证中心入口并打开 */
async function openAuthCenter(): Promise<void> {
  await goHome()
  const cards = await homeSystemCards()
  const hit = cards.find((card) => (SYS_ENTRY_NAMES as readonly string[]).includes(card.name))
  if (!hit) {
    throw new Error(
      `主屏服务宫格找不到认证中心（可接受：${SYS_ENTRY_NAMES.join(' / ')}）；实际：${JSON.stringify(cards)}`,
    )
  }
  await openSystemApp(hit.name)
  await waitFor(PAGE)
  await waitFor(STATUS)
}

describe('Auth Center（桌面端 · 系统服务面）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await openAuthCenter()
  })

  it('入口与服务面：主屏服务区可见，应用网格不含；四张卡完整渲染', async () => {
    await goHome()
    const sysCards = await homeSystemCards()
    expectEqual(
      sysCards.some((card) => (SYS_ENTRY_NAMES as readonly string[]).includes(card.name)),
      true,
      '主屏服务宫格存在认证中心入口',
    )
    const appCards = await homeAppCards()
    expectEqual(
      appCards.some((card) => card.name === APP_NAME),
      false,
      '主屏应用网格不含系统服务 Auth Center',
    )

    await openAuthCenter()
    for (const id of [PAGE, STATUS, METHODS, CONSUMERS, KEYS]) {
      expectEqual(await visible(id), true, `卡片 ${id} 可见`)
    }
  })

  it('就位状态：三态可判读，registered 时属主为本插件', async () => {
    await waitFor(STATE)
    const state = await attr(STATE, 'data-state')
    expectInSet(state, [...STATE_DOMAIN], '就位状态落在三态取值域')
    expectEqual((await text('auth-center-owner'))?.length > 0, true, '属主有值（缺失为 —）')
    expectEqual((await text('auth-center-version'))?.length > 0, true, '版本有值（缺失为 —）')
    expectEqual(await visible(ERROR), false, '状态读取无错误')

    if (state === 'registered') {
      expectEqual(
        await text('auth-center-owner'),
        'com.wasmnest.auth-center',
        'registered 时属主为 auth-center',
      )
    }
  })

  it('认证方式：固定四种，可用性与就位状态一致', async () => {
    const state = await attr(STATE, 'data-state')
    let available = 0
    for (const id of METHOD_IDS) {
      await waitFor(methodId(id))
      const value = await attr(methodId(id), 'data-available')
      expectInSet(value, ['yes', 'no'], `认证方式 ${id} 可用性取值域`)
      if (value === 'yes') available += 1
    }
    expectEqual(await count('auth-center-methods-empty'), 0, '方式列表非空')
    if (state === 'registered') {
      expectEqual(available, METHOD_IDS.length, 'registered 时四种方式全部可用')
    } else {
      expectEqual(available, 0, '未就位时全部不可用（fail-closed）')
    }
  })

  it('接入应用：计数 2，BedCode / File Transfer 均在，无自引用', async () => {
    await waitFor(CONSUMERS)
    expectEqual((await text(CONSUMERS_COUNT))?.includes('2'), true, '接入方计数为 2')
    expectEqual(await visible(CONSUMERS_ERROR), false, '接入应用读取无错误')

    // 单跑时两者为 missing；全量 staging 会一起装载，状态随宿主实际运行态变化
    const presenceDomain = [
      'missing',
      'unknown',
      'loaded',
      'activated',
      'activating',
      'degraded',
      'needsApproval',
      'error',
      'deactivated',
    ]
    for (const id of [CONSUMER_BEDCODE, CONSUMER_FILE_TRANSFER]) {
      await waitFor(consumerRow(id))
      expectInSet(await attr(consumerRow(id), 'data-state'), presenceDomain, `${id} 运行态取值域`)
      expectEqual(await visible(consumerState(id)), true, `${id} 状态徽标可见`)
    }
    expectEqual(await exists(consumerRow('com.wasmnest.auth-center')), false, '无自引用')

    // 消费面静态声明：BedCode 4 面 / File Transfer 2 面
    for (const surface of ['device-center', 'trust', 'history', 'keys']) {
      expectEqual(
        await exists(consumerSurface(CONSUMER_BEDCODE, surface)),
        true,
        `BedCode 消费面 ${surface}`,
      )
    }
    for (const surface of ['consent', 'trust']) {
      expectEqual(
        await exists(consumerSurface(CONSUMER_FILE_TRANSFER, surface)),
        true,
        `File Transfer 消费面 ${surface}`,
      )
    }
  })

  it('密钥代次：只展示 gN / 上一代，刷新不触发轮换', async () => {
    await waitFor(KEYS)
    const kid = (await text(KEYS_KID))?.trim() ?? ''
    const previous = (await text(KEYS_PREVIOUS))?.trim() ?? ''
    expectEqual(/^g\d+$/.test(kid), true, '当前代次形如 gN')
    expectEqual(previous.length > 0, true, '上一代有值（无则 —）')
    expectEqual(await visible('auth-center-keys-error'), false, '密钥卡无错误')

    await waitForEnabled(KEYS_REFRESH)
    await click(KEYS_REFRESH)
    await waitForEnabled(KEYS_ROTATE)
    expectEqual((await text(KEYS_KID))?.trim(), kid, '刷新后代次不变')
    expectEqual(await visible('auth-center-keys-error'), false, '刷新后仍无错误')
  })

  it('刷新状态：不残留 loading，不丢属主，页面保持只读无输入框', async () => {
    await waitForEnabled(REFRESH)
    await click(REFRESH)
    await waitForEnabled(REFRESH)
    expectEqual(await visible('auth-center-loading'), false, '刷新后 loading 消失')
    expectEqual((await text('auth-center-owner'))?.length > 0, true, '刷新后属主仍在')
    expectEqual(await visible(ERROR), false, '刷新后无错误')

    const inputs = await browser.execute(
      () => document.querySelectorAll('[data-testid="auth-center-page"] input').length,
    )
    expectEqual(inputs, 0, '页面不提供配对/信任输入（只读服务面）')
    expectEqual(await exists('pairing-code'), false, '不出现配对码元素')
  })
})

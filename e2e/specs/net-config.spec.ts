/**
 * Network Config 桌面端 E2E —— 系统服务面（T18）
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app net-config
 *
 * 判据纪律：
 * 1. 页面**不写**真实配置：导入用例只喂非法载荷（校验失败 = 不落盘）；成功导入
 *    会持久改用户的 relay 配置，E2E 不做。
 * 2. 当前配置只有两种合法呈现：已配置（PeerId / 地址有值）或未配置（空态）；
 *    二者之外必须出现显性错误（不允许「空白页面」冒充未配置）。
 * 3. 业务注册表随 staging 装载哪些应用变化：只断言取值域，不写死行数。
 * 4. 探测按钮必须禁用（宿主 relay 拨号原语未装配）；出现可点按钮 = 伪造能力。
 */

import { browser } from '@wdio/globals'
import {
  click,
  exists,
  isDisabled,
  setValue,
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
  CLEAR,
  CURRENT,
  CURRENT_ADDRS,
  CURRENT_CARD,
  CURRENT_PEER_ID,
  CURRENT_SOURCE,
  DEPLOY,
  DEPLOY_ADVERTISE,
  DEPLOY_EMPTY,
  DEPLOY_OUTPUT,
  IMPORT,
  IMPORT_ERROR,
  IMPORT_INPUT,
  IMPORT_SUBMIT,
  LOAD_ERROR,
  PAGE,
  PROBE,
  PROBE_BUTTON,
  PROBE_DOCTOR,
  PROBE_UNSUPPORTED,
  REFRESH,
  STATE_CONFIGURED,
  STATE_EMPTY,
  SYS_ENTRY_NAMES,
  WAN,
  WAN_EMPTY,
  WAN_ERROR,
  deployMode,
} from '../pages/netConfig'

/** 主屏服务宫格找到网络配置入口并打开 */
async function openNetConfig(): Promise<void> {
  await goHome()
  const cards = await homeSystemCards()
  const hit = cards.find((card) => (SYS_ENTRY_NAMES as readonly string[]).includes(card.name))
  if (!hit) {
    throw new Error(
      `主屏服务宫格找不到网络配置（可接受：${SYS_ENTRY_NAMES.join(' / ')}）；实际：${JSON.stringify(cards)}`,
    )
  }
  await openSystemApp(hit.name)
  await waitFor(PAGE)
}

describe('Network Config（桌面端 · 系统服务面）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await openNetConfig()
  })

  it('入口与服务面：主屏服务区可见，应用网格不含；四张卡完整渲染', async () => {
    await goHome()
    const sysCards = await homeSystemCards()
    expectEqual(
      sysCards.some((card) => (SYS_ENTRY_NAMES as readonly string[]).includes(card.name)),
      true,
      '主屏服务宫格存在网络配置入口',
    )
    const appCards = await homeAppCards()
    expectEqual(
      appCards.some((card) => card.name === APP_NAME),
      false,
      '主屏应用网格不含系统服务 Network Config',
    )

    await openNetConfig()
    for (const id of [CURRENT_CARD, WAN, DEPLOY, IMPORT, PROBE]) {
      expectEqual(await visible(id), true, `卡片 ${id} 可见`)
    }
  })

  it('当前配置：已配置 / 未配置二选一，读不到必须显性报错', async () => {
    const hasError = await exists(LOAD_ERROR)
    const configured = await exists(STATE_CONFIGURED)
    const empty = await exists(STATE_EMPTY)
    expectEqual(
      hasError || configured || empty,
      true,
      '当前配置必须是「已配置 / 未配置 / 显性错误」之一',
    )
    if (hasError) {
      expectEqual((await text(LOAD_ERROR))?.length > 0, true, '读取失败必须带原因')
      return
    }
    if (configured) {
      expectEqual((await text(CURRENT_PEER_ID))?.length > 0, true, '已配置时 PeerId 有值')
      expectEqual((await text(CURRENT_ADDRS))?.length > 0, true, '已配置时地址有值')
      expectEqual((await text(CURRENT_SOURCE))?.length > 0, true, '已配置时来源有值')
    } else {
      expectEqual(await visible(CURRENT), false, '未配置时不渲染配置摘要')
    }
  })

  it('部署文本：填写对外域名生成 Compose，切换形态生效；非法输入显性报错', async () => {
    expectEqual(await visible(DEPLOY_EMPTY), true, '未填写时显示空态提示')

    await setValue(DEPLOY_ADVERTISE, 'relay.example.com')
    await waitFor(DEPLOY_OUTPUT)
    const compose = (await text(DEPLOY_OUTPUT)) ?? ''
    expectEqual(compose.includes('ghcr.io/7zai/wasmnest-relay'), true, 'Compose 含镜像仓库')
    expectEqual(compose.includes('4001:4001/tcp'), true, 'Compose 含默认端口映射')
    expectEqual(compose.includes('--advertise relay.example.com'), true, 'Compose 含对外域名')

    await click(deployMode('docker'))
    await waitFor(DEPLOY_OUTPUT)
    expectEqual(((await text(DEPLOY_OUTPUT)) ?? '').includes('docker run'), true, 'Docker 形态')

    await click(deployMode('systemd'))
    await waitFor(DEPLOY_OUTPUT)
    expectEqual(
      ((await text(DEPLOY_OUTPUT)) ?? '').includes('./install.sh --advertise'),
      true,
      'systemd 形态',
    )

    await setValue(DEPLOY_ADVERTISE, '/bad')
    await waitFor('net-config-deploy-error')
    expectEqual(await visible(DEPLOY_OUTPUT), false, '非法域名不产出文本')
  })

  it('导入：非法载荷显性报错且不改动当前配置', async () => {
    const beforePeer = (await text(CURRENT_PEER_ID)) ?? null
    await setValue(IMPORT_INPUT, 'hello world')
    await waitForEnabled(IMPORT_SUBMIT)
    await click(IMPORT_SUBMIT)
    await waitFor(IMPORT_ERROR)
    expectEqual((await text(IMPORT_ERROR))?.length > 0, true, '非法导入必须带原因')
    expectEqual(
      (await text(CURRENT_PEER_ID)) ?? null,
      beforePeer,
      '非法导入不得改动当前配置',
    )
  })

  it('连通性：宿主未装配时按钮禁用，给出 doctor 出路（不伪造可用）', async () => {
    expectEqual(await visible(PROBE_UNSUPPORTED), true, '显性说明探测能力未装配')
    expectEqual(await visible(PROBE_BUTTON), true, '按钮存在')
    expectEqual(await isDisabled(PROBE_BUTTON), true, '按钮必须禁用（可点 = 伪造能力）')
    expectEqual(
      ((await text(PROBE_DOCTOR)) ?? '').includes('wasmnest-relay doctor'),
      true,
      '给出服务器侧自检命令',
    )
  })

  it('业务注册表：行状态取值域；空表走空态；读取失败显性可见', async () => {
    const rows = await browser.execute(
      () => document.querySelectorAll('[data-testid^="net-config-wan-row-"]').length,
    )
    if ((await exists(WAN_ERROR)) === false) {
      expectEqual(await visible(WAN_EMPTY), rows === 0, '无行时显示空态')
      if (rows > 0) {
        const allowed = await browser.execute(
          () =>
            document
              .querySelector('[data-testid="net-config-wan-state-com.wasmnest.bedcode"]')
              ?.getAttribute('data-allowed') ?? null,
        )
        if (allowed !== null) expectInSet(allowed, ['true', 'false'], 'bedcode 开关取值域')
      }
    }
  })

  it('刷新：不残留 loading，页面保持无写操作副作用', async () => {
    await waitForEnabled(REFRESH)
    await click(REFRESH)
    await waitForEnabled(REFRESH)
    expectEqual(await exists(LOAD_ERROR) || await exists(STATE_CONFIGURED) || await exists(STATE_EMPTY), true, '刷新后状态仍可判读')
    // 显式移除按钮只在已配置时存在；E2E 不点它（会清用户配置）
    expectEqual(await exists(CLEAR), await exists(STATE_CONFIGURED), '移除入口与配置状态一致')
  })
})

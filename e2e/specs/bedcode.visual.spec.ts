/**
 * BedCode 编排视觉验收（opt-in，不参与默认 E2E）
 *
 * 默认 E2E 只跑 `bedcode.spec.ts`；本文件用于在真实宿主里生成列表 / 详情 /
 * 计划编辑器的截图，供样式改动前后对比。跑法：
 *
 *   XDG_DATA_HOME=<隔离数据根> node scripts/e2e.mjs --app bedcode \
 *     --spec e2e/specs/bedcode.visual.spec.ts
 *
 * 截图输出 /tmp/bedcode-orch-shots/。用隔离数据根的原因：本机旧插件库可能缺少
 * 新列（orchestrations.planner_*），命令会以 host.internal 失败；把数据根复制到
 * 临时目录并重置 orchestration_* 表即可让宿主按最新 schema 建表，不影响真实数据。
 */

import { browser } from '@wdio/globals'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  allowFsAuthPrompts,
  click,
  clickContaining,
  exists,
  isDisabled,
  typeInto,
  waitFor,
  waitForEnabled,
  waitForHostReady,
  waitGone,
} from '../harness/driver'
import { clickAppCard, goHome, waitForAppRoute } from '../harness/shell'

const APP_NAME = 'BedCode'
const SHOT_DIR = '/tmp/bedcode-orch-shots'
const PROJECT_DIR = join(homedir(), 'bedcode-orchestration-visual')

mkdirSync(SHOT_DIR, { recursive: true })
mkdirSync(PROJECT_DIR, { recursive: true })
writeFileSync(join(PROJECT_DIR, 'README.md'), '# orchestration visual seed\n')

async function shot(name: string): Promise<void> {
  await browser.saveScreenshot(join(SHOT_DIR, `${name}.png`))
}

async function scrollTop(): Promise<void> {
  await browser.execute(() => {
    const root = document.querySelector('[data-testid="orchestration-detail"]')
    const scroller = root?.querySelector('.overflow-auto')
    scroller?.scrollTo(0, 0)
  })
}

describe('BedCode 编排视觉验收（opt-in）', () => {
  it('截图列表 / 详情 / 计划编辑', async () => {
    await waitForHostReady()
    await goHome()
    // 隔离数据根首次激活会弹「文件访问授权」并挡住壳路由：先点卡片，
    // 允许授权，再等路由离开主屏（默认套件假设 app 已激活，不适用于隔离根）。
    await clickAppCard(APP_NAME, 45_000)
    await allowFsAuthPrompts()
    await waitForAppRoute(APP_NAME, 45_000)
    await waitFor('bedcode-root')

    try {
      await browser.setWindowSize(1920, 1080)
    } catch {
      // 窗口管理器不支持时按宿主默认尺寸截图
    }

    // 项目是新建编排的前置；已有项目时直接复用
    await click('nav-projects')
    await waitFor('projects-view')
    if (!(await exists('project-card'))) {
      await click('projects-create')
      await waitFor('project-form-dir')
      await typeInto('project-form-dir', PROJECT_DIR)
      await click('project-form-submit')
      await waitFor('project-workbench')
    }

    // 编排 v2 的前置：Agent 池里至少有一个可派发的子 agent（从已安装的桥接 CLI 创建）。
    // 本机没有 pi/opencode 时无法创建，直接跳过截图（opt-in 套件的机器前提）。
    await click('nav-orchestrations')
    await waitFor('orchestration-list')
    await click('orchestration-tab-pool')
    await waitFor('orchestration-pool')
    if (!(await exists('orchestration-pool-card'))) {
      let canCreate = true
      try {
        if (await isDisabled('orchestration-pool-create')) {
          // 探测是异步的：显式刷新 CLI 状态，再等按钮从 disabled 变为可点
          await click('orchestration-pool-refresh-cli')
        }
        await waitForEnabled('orchestration-pool-create', 45_000)
      } catch {
        canCreate = false
      }
      if (!canCreate || (await isDisabled('orchestration-pool-create'))) {
        console.warn('[visual] no bridge-capable CLI installed; skipping orchestration screenshots')
        return
      }
      await click('orchestration-pool-create')
      await waitFor('orchestration-pool-name')
      await typeInto('orchestration-pool-name', '视觉验收 Agent')
      await typeInto('orchestration-pool-specialties', '前端实现, 样式还原')
      await typeInto('orchestration-pool-description', '负责前端页面实现与联调，不改 Rust 后端。')
      await click('orchestration-pool-save')
      await waitFor('orchestration-pool-card')
      // 保存成功的判据是弹窗退场；卡片在背景里先出现时弹窗还在过渡
      await waitGone('orchestration-pool-form')
    }
    await shot('00-pool')
    await click('orchestration-tab-list')
    await waitFor('orchestration-list')

    await click('orchestration-create')
    await waitFor('orchestration-create-name')
    await typeInto('orchestration-create-name', '编排视觉审核')
    await typeInto('orchestration-create-goal', '验证列表与详情的层级、状态色与表单密度')
    await click('orchestration-create-submit')
    await waitFor('orchestration-detail')
    await waitFor('orchestration-plan-editor')
    await shot('01-detail-plan-editor')

    // 填一个可保存的节点，让工作流 / 流水线 / 节点卡都有内容
    await typeInto('orchestration-plan-title', '登录页联调')
    await typeInto('orchestration-plan-goal', '验证列表与详情的层级、状态色与表单密度')
    await click('orchestration-plan-add-node')
    await waitFor('orchestration-plan-node-title')
    await typeInto('orchestration-plan-node-title', '实现登录表单')
    await typeInto(
      'orchestration-plan-node-prompt',
      '在 src/pages/login 下实现登录表单与校验，并补充单测。',
    )
    await typeInto('orchestration-plan-node-scope', 'src/pages/login')
    await shot('02-detail-plan-filled')
    await click('orchestration-plan-save')
    await waitFor('orchestration-plan-node')
    await waitGone('orchestration-plan-editor')
    await scrollTop()
    await shot('03-detail-with-plan')

    // 选中节点：检查工作流与流水线的选中态
    await click('orchestration-workflow-node')
    await shot('04-detail-selected')

    // 列表（新建后返回）：KeepAlive 返回时列表会重新取数，等行出现再截图
    await click('orchestration-back')
    await waitGone('orchestration-detail')
    await waitFor('orchestration-list')
    await waitFor('orchestration-row')
    await shot('05-list')

    // 窄窗口再看一次（验证筛选条 / 卡片换行与详情动作区）
    try {
      await browser.setWindowSize(1024, 760)
      await shot('06-list-narrow')
      if (await clickContaining('orchestration-row', '编排视觉审核')) {
        await waitFor('orchestration-detail')
        await waitGone('orchestration-list')
        await shot('07-detail-narrow')
      }
    } catch {
      // 忽略窗口尺寸不受支持的环境
    }
  })
})

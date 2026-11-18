/**
 * Agent Hub Skills 管理域编排（票据 04）
 *
 * - 挂载时拉取持久化状态（host-storage `skills` 键），此后 guest 每次变更
 *   全量 emit `plugin:bedcode:skills`，本 composable 订阅覆盖本地状态
 * - 状态为 idle（从未扫描）时自动触发一次扫描
 * - 扫描/导入为异步进程（guest 经 host-process 枚举目录），完成经事件回流；
 *   GitHub 安装为同步命令（多次 host-http 往返），本地瞬态遮罩
 * - 编辑流：read-skill 装载 → 前端 diff 预览 → save-skill（冲突时 guest
 *   返回磁盘现状，由编辑器组件呈现冲突 UI）
 * - 联网搜索：skills.sh API（精确查询 + 逐词近似合并），同步命令，结果由
 *   组件持有（不进域状态——搜索是视图态，不应被事件回流覆盖）
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { logger } from '@/utils/frontendLogger'
import type {
  GithubInstallResult,
  ImportSkillResult,
  SkillDetail,
  SkillSearchResponse,
  SkillsDomainState,
} from '../types'

export type UseSkillsReturn = ReturnType<typeof useSkills>

export function useSkills(context: PluginContext) {
  const state = ref<SkillsDomainState | null>(null)
  /** GitHub 安装进行中（同步命令，本地瞬态） */
  const githubBusy = ref(false)
  /** 分发进行中（同步命令，本地瞬态） */
  const distributing = ref<string | null>(null)
  /** 自动扫描已触发过（避免事件风暴下重复发起） */
  let autoScanDone = false

  async function refresh() {
    try {
      const data = await context.commands.execute('agent.get-skills-state', {})
      applyState((data?.state ?? null) as SkillsDomainState | null)
    } catch (e) {
      console.error('[Agent Hub] get-skills-state failed', e)
    }
  }

  function applyState(next: SkillsDomainState | null) {
    state.value = next
    if (next?.status === 'idle' && !autoScanDone) {
      autoScanDone = true
      void scan()
    }
  }

  /** 触发规范库扫描（枚举 + hash + 分发比对，结果经事件回流） */
  async function scan() {
    try {
      await context.commands.execute('agent.scan-skills', {})
    } catch (e) {
      console.error('[Agent Hub] scan-skills failed', e)
    }
  }

  /**
   * 读取 skill 的 SKILL.md（编辑器装载）
   *
   * 失败必须落前端日志（`logger.error` → 宿主 `report_frontend_log`，release 下也落盘）：
   * 编辑器把 `null` 呈现为「读取失败，请重试（详情见应用日志）」，而 raw console
   * 在生产构建里不进日志文件——排查时会拿不到真正原因（2026-11-15 实机排查教训）。
   */
  async function readSkill(dir: string): Promise<SkillDetail | null> {
    try {
      const data = await context.commands.execute('agent.read-skill', { dir })
      return (data ?? null) as SkillDetail | null
    } catch (e) {
      logger.error('[Agent Hub] read-skill failed', dir, e)
      return null
    }
  }

  /** 保存 SKILL.md；冲突时返回磁盘现状（saved=false + conflict=true） */
  async function saveSkill(
    dir: string,
    baseContent: string,
    content: string,
    force = false,
  ): Promise<{ saved: boolean; conflict?: boolean; current?: string }> {
    try {
      const data = await context.commands.execute('agent.save-skill', {
        dir,
        baseContent,
        content,
        force,
      })
      return data as { saved: boolean; conflict?: boolean; current?: string }
    } catch (e) {
      console.error('[Agent Hub] save-skill failed', dir, e)
      return { saved: false }
    }
  }

  /** 分发/重新分发到目标 CLI（targets 缺省 = 全部）；结果经事件回流 */
  async function distribute(dir: string, targets?: string[]) {
    if (distributing.value) return
    distributing.value = dir
    try {
      await context.commands.execute('agent.distribute-skill', { dir, targets })
    } catch (e) {
      console.error('[Agent Hub] distribute-skill failed', dir, e)
    } finally {
      distributing.value = null
    }
  }

  /**
   * 删除 / 卸载 skill：规范库目录与全部分发副本一并删净（guest 异步进程，
   * 结果经 `plugin:bedcode:skills` 回灌到 `state.delete.last`）。
   *
   * 返回 `started=false` 只代表命令本身被拒（未知 skill / 并发删除 / 管道
   * 失败），条目仍在列表里——调用方必须把 `error` 呈现为可见失败。
   */
  async function deleteSkill(dir: string): Promise<{ started: boolean; error?: string }> {
    try {
      await context.commands.execute('agent.delete-skill', { dir })
      return { started: true }
    } catch (e) {
      logger.error('[Agent Hub] delete-skill failed', dir, e)
      return { started: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * GitHub 安装（overwrite 用于同名 skill 的覆盖确认重试）
   *
   * `skill` = 只装仓库里的某一个 skill（联网搜索结果安装：skills.sh 结果是
   * `owner/repo@skill`，不是仓库 URL；guest 按 skill 名定位目录）。
   */
  async function installGithub(
    url: string,
    overwrite = false,
    skill?: string,
  ): Promise<GithubInstallResult | null> {
    if (githubBusy.value) return null
    githubBusy.value = true
    try {
      const data = await context.commands.execute('agent.install-github-skill', {
        url,
        overwrite,
        ...(skill ? { skill } : {}),
      })
      return (data ?? null) as GithubInstallResult | null
    } catch (e) {
      console.error('[Agent Hub] install-github-skill failed', e)
      return null
    } finally {
      githubBusy.value = false
    }
  }

  /**
   * skills.sh 联网搜索（同步命令：精确查询 + 逐词近似合并，1–4 次 host-http）
   *
   * 返回 null 只代表命令本身失败（宿主管道/权限）；网络不可达由返回体的
   * `error` 字段表达，前端据此给出可见提示而非空结果。
   */
  async function searchRemote(query: string): Promise<SkillSearchResponse | null> {
    try {
      const data = await context.commands.execute('agent.search-skills', { query })
      return (data ?? null) as SkillSearchResponse | null
    } catch (e) {
      console.error('[Agent Hub] search-skills failed', e)
      return null
    }
  }

  /**
   * 本地目录导入：无 path 时先弹目录选择器；exists/auth 分支由调用方
   * 处理（覆盖确认 / 授权失败提示），确认后携 path+force 重入
   */
  async function importLocal(opts?: { path?: string; force?: boolean }): Promise<ImportSkillResult | null> {
    try {
      const data = await context.commands.execute('agent.import-skill', opts ?? {})
      return (data ?? null) as ImportSkillResult | null
    } catch (e) {
      console.error('[Agent Hub] import-skill failed', e)
      return null
    }
  }

  const subscription = context.events.on('plugin:bedcode:skills', (payload: SkillsDomainState) => {
    applyState(payload)
  })

  onMounted(() => {
    void refresh()
  })

  onUnmounted(() => {
    subscription.dispose()
  })

  return {
    state,
    githubBusy,
    distributing,
    refresh,
    scan,
    readSkill,
    saveSkill,
    distribute,
    deleteSkill,
    installGithub,
    searchRemote,
    importLocal,
  }
}

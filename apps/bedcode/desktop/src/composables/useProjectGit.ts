/**
 * 项目 Git 提交图数据层（`project.git-log`）
 *
 * 与文件树同一条取数纪律：命令全部经 `context.commands.execute` 走本 app 的
 * Rust 分派（桌面前端零资源访问），只在「Git」页签可见时取数——用户没打开
 * Git 视图就不该触发一次 git 进程。图形布局不在数据层：提交列表是纯数据，
 * 车道 / 连线由 `utils/gitGraph` 的纯函数按拓扑序推导。
 */
import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 单次拉取的提交上限（与 Rust 侧 DEFAULT_LIMIT 同口径） */
export const PROJECT_GIT_LIMIT = 300

/** 一条提交（前端形状；字段来自 project.git-log 的 wire） */
export interface GitCommit {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  email: string
  /** 作者时间（RFC 3339） */
  date: string
  /** git 引用装饰原文（`HEAD -> dev` / `tag: v1.0.0` / `origin/dev`） */
  refs: string[]
  subject: string
}

/** 后端提交 → 前端提交；缺 hash 的记录丢弃（无法在图里定位） */
export function toGitCommit(raw: unknown): GitCommit | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const hash = typeof record.hash === 'string' ? record.hash : ''
  if (!hash) return null

  const parents = Array.isArray(record.parents)
    ? record.parents.filter((parent): parent is string => typeof parent === 'string' && !!parent)
    : []
  const refs = Array.isArray(record.refs)
    ? record.refs.filter((ref): ref is string => typeof ref === 'string' && !!ref)
    : []

  return {
    hash,
    shortHash:
      typeof record.shortHash === 'string' && record.shortHash
        ? record.shortHash
        : hash.slice(0, 7),
    parents,
    author: typeof record.author === 'string' ? record.author : '',
    email: typeof record.email === 'string' ? record.email : '',
    date: typeof record.date === 'string' ? record.date : '',
    refs,
    subject: typeof record.subject === 'string' ? record.subject : '',
  }
}

export function useProjectGit(context: PluginContext, projectId: Ref<string>) {
  /** 目录是否是 git 仓库（非仓库是正常空态，不是错误） */
  const isGitRepo = ref(true)
  /** 当前分支；detached HEAD / 读不到时为空串 */
  const currentBranch = ref('')
  const commits = ref<GitCommit[]>([])
  /** 是否因上限被截断（窗口外还有更老的提交） */
  const truncated = ref(false)
  const isLoading = ref(false)
  /** 最近一次读取失败（原始 rejection；文案由视图层解析） */
  const error = ref<unknown>(null)
  /** 是否已成功读过（`false` = 还没读过 / 上次失败） */
  const isLoaded = ref(false)

  /** 防止旧请求覆盖新请求（刷新 / 项目切换时可能出现竞态） */
  let loadSeq = 0

  /** 读取提交图（`force` = 刷新：丢弃缓存重新拉） */
  async function load(force = false): Promise<void> {
    if (isLoading.value) return
    if (isLoaded.value && !force) return
    const id = projectId.value
    if (!id) return
    const seq = ++loadSeq
    isLoading.value = true
    error.value = null
    try {
      const raw = (await context.commands.execute('project.git-log', {
        projectId: id,
        limit: PROJECT_GIT_LIMIT,
      })) as {
        isGitRepo?: unknown
        currentBranch?: unknown
        commits?: unknown
        truncated?: unknown
      } | null
      if (seq !== loadSeq) return

      isGitRepo.value = raw?.isGitRepo !== false
      currentBranch.value = typeof raw?.currentBranch === 'string' ? raw.currentBranch : ''
      commits.value = Array.isArray(raw?.commits)
        ? raw.commits
            .map((commit) => toGitCommit(commit))
            .filter((commit): commit is GitCommit => commit !== null)
        : []
      truncated.value = raw?.truncated === true
      isLoaded.value = true
    } catch (e) {
      if (seq !== loadSeq) return
      console.error('[Project Git] load log failed:', e)
      error.value = e
      commits.value = []
      truncated.value = false
      isLoaded.value = false
    } finally {
      if (seq === loadSeq) isLoading.value = false
    }
  }

  /** 项目切换：清空上一份历史与状态 */
  function reset(): void {
    loadSeq += 1
    isGitRepo.value = true
    currentBranch.value = ''
    commits.value = []
    truncated.value = false
    isLoading.value = false
    error.value = null
    isLoaded.value = false
  }

  return {
    isGitRepo,
    currentBranch,
    commits,
    truncated,
    isLoading,
    error,
    isLoaded,
    load,
    reset,
  }
}

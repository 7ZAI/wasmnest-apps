/**
 * 项目文件树数据层（project.file-tree / project.file-content）
 *
 * 与移动端文件浏览同语义：根 = 项目 `workingDir`，单层懒加载、排除重目录、
 * 文件只读。差异只在取数通道——桌面前端没有 HTTP 面，命令全部经
 * `context.commands.execute` 走本 app 的 Rust 分派。
 *
 * 树的节点状态（`expanded` / `loading` / `children`）直接挂在节点上：展开是纯
 * 视图态，不需要响应式深层代理之外的额外映射；同一节点重复展开时 `children`
 * 已存在就不再请求（目录内容在一次会话内视为稳定，刷新按钮显式作废）。
 */
import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 文件树节点（前端形状；`nodeType` → `type` 在转换层完成） */
export interface ProjectFileNode {
  name: string
  type: 'file' | 'folder'
  /** 相对项目根目录的路径（`/` 分隔） */
  path: string
  children?: ProjectFileNode[]
  expanded?: boolean
  loading?: boolean
}

/** 默认排除目录（与移动端 `DEFAULT_SETTINGS.filterPatterns` 同口径） */
export const PROJECT_FILE_EXCLUDES: string[] = ['node_modules', 'target', '.git', 'dist', 'build']

/** 后端节点（`{name, nodeType, path, children?}`；字段来自 file_browse 的宿主契约） */
interface RawFileNode {
  name?: unknown
  nodeType?: unknown
  path?: unknown
  children?: unknown
}

/** 后端节点 → 前端节点：路径统一 `/`（Windows 后端可能回反斜杠），文件夹可展开 */
export function toProjectFileNode(raw: RawFileNode): ProjectFileNode {
  const isFolder = raw.nodeType === 'folder'
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    type: isFolder ? 'folder' : 'file',
    path: typeof raw.path === 'string' ? raw.path.replace(/\\/g, '/') : '',
    children: Array.isArray(raw.children)
      ? raw.children.map((child) => toProjectFileNode(child as RawFileNode))
      : undefined,
    expanded: isFolder ? false : undefined,
  }
}

export function useProjectFiles(context: PluginContext, projectId: Ref<string>) {
  const tree = ref<ProjectFileNode[]>([])
  const isLoading = ref(false)
  /** 最近一次根目录读取失败（原始 rejection；文案由视图层解析） */
  const error = ref<unknown>(null)
  /** 根目录是否已成功读过（`false` = 还没读过 / 上次失败） */
  const isLoaded = ref(false)

  /** 防止旧请求覆盖新请求（刷新 / 项目切换时可能出现竞态） */
  let loadSeq = 0

  async function requestChildren(dirPath?: string): Promise<ProjectFileNode[]> {
    const id = projectId.value
    if (!id) return []
    const raw = (await context.commands.execute('project.file-tree', {
      projectId: id,
      // 根目录不传 dirPath（后端缺省 = 工作目录）
      ...(dirPath ? { dirPath } : {}),
      excludeDirs: [...PROJECT_FILE_EXCLUDES],
    })) as { children?: RawFileNode[] } | null
    return Array.isArray(raw?.children) ? raw!.children!.map((node) => toProjectFileNode(node)) : []
  }

  /** 读取根目录（`force` = 刷新：丢弃已缓存的整棵树） */
  async function loadRoot(force = false): Promise<void> {
    // force 刷新必须能覆盖进行中的请求（旧响应由 loadSeq 丢弃）；
    // 否则刷新按钮在加载期间点击会被静默忽略。
    if (isLoading.value && !force) return
    if (isLoaded.value && !force) return
    const seq = ++loadSeq
    isLoading.value = true
    error.value = null
    try {
      const children = await requestChildren()
      if (seq !== loadSeq) return
      tree.value = children
      isLoaded.value = true
    } catch (e) {
      if (seq !== loadSeq) return
      console.error('[Project Files] load tree failed:', e)
      error.value = e
      tree.value = []
      isLoaded.value = false
    } finally {
      if (seq === loadSeq) isLoading.value = false
    }
  }

  /** 展开 / 收起文件夹；首次展开时读取该层子节点（失败上抛给视图层提示） */
  async function toggleNode(node: ProjectFileNode): Promise<void> {
    if (node.type !== 'folder') return
    node.expanded = !node.expanded
    if (!node.expanded || node.children !== undefined || node.loading) return
    node.loading = true
    try {
      node.children = await requestChildren(node.path)
    } catch (e) {
      // 失败回退展开态：留在「已展开但空」会让人以为目录真的空
      node.expanded = false
      node.children = undefined
      throw e
    } finally {
      node.loading = false
    }
  }

  /** 全部收起（已加载的 children 保留，再次展开不重复请求） */
  function collapseAll(): void {
    const walk = (nodes: ProjectFileNode[]): void => {
      for (const node of nodes) {
        if (node.type !== 'folder') continue
        node.expanded = false
        if (node.children) walk(node.children)
      }
    }
    walk(tree.value)
  }

  /** 读取文件内容（二进制 / 超大文件由后端显性拒绝） */
  async function readFile(filePath: string): Promise<{ content: string; fileName: string }> {
    const raw = (await context.commands.execute('project.file-content', {
      projectId: projectId.value,
      filePath,
    })) as { content?: unknown; fileName?: unknown } | null
    if (typeof raw?.content !== 'string') {
      throw new Error('project.file-content returned no content')
    }
    return {
      content: raw.content,
      fileName:
        typeof raw.fileName === 'string' && raw.fileName
          ? raw.fileName
          : filePath.split('/').pop() || filePath,
    }
  }

  /** 项目切换：清空上一棵树的全部状态 */
  function reset(): void {
    loadSeq += 1
    tree.value = []
    isLoading.value = false
    error.value = null
    isLoaded.value = false
  }

  return {
    tree,
    isLoading,
    error,
    isLoaded,
    loadRoot,
    toggleNode,
    collapseAll,
    readFile,
    reset,
  }
}

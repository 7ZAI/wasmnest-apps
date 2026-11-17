/**
 * 远端目录浏览 (Mobile) — host-peer 契约版
 *
 * 两级结构：对端共享根清单（peer_list_shared_roots）→ 根内目录树
 * （browse_directory(dirId, relPath)）。path 语义 = 「根内相对路径」，
 * dirId 为共享根条目 id（browse/pull 按其寻址）。
 */
import { ref, computed } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { RemoteEntry } from '../types'

/** 共享根条目 */
export interface SharedRootRef {
  id: string
  name: string
}

/**
 * 根清单拉取的就绪键（空串 = 现在不该拉）。
 *
 * 三个条件缺一不可：活跃对端存在、连接已建立、至少有一条可用地址。最后一条
 * 常被忽略——入站（被连）侧没有拨号会话句柄，必须按 endpoint 重拨才能拉清单，
 * 地址未就绪时发起只会拿到 `no-endpoint`。
 */
export function rootsReadyKey(input: {
  peerId: string
  online: boolean
  connectionModes: 'both' | 'lan' | 'wan' | 'none'
}): string {
  if (!input.peerId || !input.online) return ''
  return input.connectionModes === 'none' ? '' : input.peerId
}

export function useRemoteFs(context: PluginContext, getPeerId: () => string = () => '') {
  /**
   * 寻址参数：显式带上活跃对端 id，后端不必依赖 `set-active-peer` 的到达时序
   * （入站连接建立与拉取几乎同刻发生，插件侧 ACTIVE_NODE 可能还没落值）。
   */
  function targetArgs(): { peerId?: string } {
    const peerId = getPeerId()
    return peerId ? { peerId } : {}
  }

  /** 当前所在共享根（null = 处于根清单层） */
  const currentRoot = ref<SharedRootRef | null>(null)
  /** 根内相对路径（"" = 根目录） */
  const currentPath = ref('')
  /** 目录项列表（根清单层复用同一展示容器，isDir=true 视觉呈现为可进入） */
  const entries = ref<RemoteEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 对端分区存储过滤提示 */
  const notice = ref<string | null>(null)
  /** 最近一次根清单快照（根清单层点击进入共享根时按展示名解析真实 dirId） */
  let rootsCache: SharedRootRef[] = []

  /** 已勾选文件名集合（当前目录内唯一） */
  const selected = ref<Set<string>>(new Set())

  /** 面包屑分段：根名 + 路径段 */
  const crumbs = computed(() => {
    if (!currentRoot.value) return []
    return [currentRoot.value.name, ...currentPath.value.split('/').filter(Boolean)]
  })

  const selectedCount = computed(() => selected.value.size)

  const selectedTotalSize = computed(() => {
    let total = 0
    for (const e of entries.value) {
      if (selected.value.has(e.name) && !e.isDir) total += e.size
    }
    return total
  })

  const allSelected = computed(
    () => entries.value.length > 0 && entries.value.every((e) => selected.value.has(e.name)),
  )

  /** 加载共享根清单（path="" 且未选根） */
  async function loadRoots(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await context.commands.execute('file-transfer.list-remote', {
        path: '',
        dirId: '',
        ...targetArgs(),
      })
      const roots: SharedRootRef[] = Array.isArray(data?.roots) ? data.roots : []
      // 缓存 id ↔ name 映射：entries 仅保留展示名，进入共享根需按名回查真实 id
      rootsCache = roots
      entries.value = roots.map((r) => ({ name: r.name, size: 0, mtime: 0, isDir: true }))
      notice.value = null
      currentPath.value = ''
    } catch (e) {
      console.error('[File Transfer] list-remote roots FAILED:', e)
      error.value = context.i18n.t('transfer.table.dirUnavailable')
      entries.value = []
    } finally {
      loading.value = false
    }
  }

  /** 加载当前根内的 relPath 目录 */
  async function loadDir(relPath: string): Promise<void> {
    if (!currentRoot.value) return
    loading.value = true
    error.value = null
    try {
      const data = await context.commands.execute('file-transfer.list-remote', {
        path: relPath,
        dirId: currentRoot.value.id,
        ...targetArgs(),
      })
      entries.value = Array.isArray(data?.entries) ? data.entries : []
      notice.value = data?.notice ?? null
      currentPath.value = relPath
      selected.value = new Set()
    } catch (e) {
      console.error(`[File Transfer] list-remote FAILED: path='${relPath}'`, e)
      error.value = context.i18n.t('transfer.table.dirUnavailable')
      entries.value = []
    } finally {
      loading.value = false
    }
  }

  /** 刷新当前层级（根清单或目录） */
  async function refresh(): Promise<void> {
    if (currentRoot.value) await loadDir(currentPath.value)
    else await loadRoots()
  }

  /** 进入共享根 */
  async function enterRoot(root: SharedRootRef): Promise<void> {
    currentRoot.value = root
    await loadDir('')
  }

  /** 进入子目录（仅根内有效） */
  async function cd(name: string): Promise<void> {
    if (!currentRoot.value) {
      // 根清单层点击 = 进入该共享根；dirId 必须是宿主分配的条目 id，
      // 展示名 ≠ id，直接拿名字当 id 会命中不了目录表（表现为「目录不可用」），
      // 与桌面端同构：按展示名从最近一次根清单解析真实 id，缺失才兜底同名
      const root = rootsCache.find((r) => r.name === name) ?? { id: name, name }
      await enterRoot(root)
      return
    }
    const next = currentPath.value ? `${currentPath.value}/${name}` : name
    await loadDir(next)
  }

  /** 返回上级（根内首层返回 → 回根清单） */
  async function up(): Promise<void> {
    if (!currentRoot.value) return
    const segs = currentPath.value.split('/').filter(Boolean)
    segs.pop()
    if (segs.length === 0) {
      await goRoot()
    } else {
      await loadDir(segs.join('/'))
    }
  }

  /** 回到共享根清单 */
  async function goRoot(): Promise<void> {
    currentRoot.value = null
    await loadRoots()
  }

  /** 面包屑跳转（0 = 根清单；i≥1 = 根内路径段） */
  async function goTo(index: number): Promise<void> {
    if (index < 0 || !currentRoot.value) {
      await goRoot()
      return
    }
    const segs = currentPath.value.split('/').filter(Boolean).slice(0, index)
    await loadDir(segs.join('/'))
  }

  function toggle(name: string): void {
    const next = new Set(selected.value)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    selected.value = next
  }

  function toggleAll(): void {
    if (!currentRoot.value) return
    if (allSelected.value) selected.value = new Set()
    else selected.value = new Set(entries.value.map((e) => e.name))
  }

  function clearSelection(): void {
    selected.value = new Set()
  }

  /** 重置浏览状态（对端下线时调用） */
  function reset(): void {
    rootsCache = []
    currentRoot.value = null
    currentPath.value = ''
    entries.value = []
    loading.value = false
    error.value = null
    notice.value = null
    selected.value = new Set()
  }

  /** 当前勾选文件名列表（不含目录） */
  const selectedFiles = computed(() =>
    entries.value.filter((e) => !e.isDir && selected.value.has(e.name)).map((e) => e.name),
  )

  return {
    currentRoot,
    currentPath,
    entries,
    loading,
    error,
    notice,
    crumbs,
    selected,
    selectedCount,
    selectedTotalSize,
    allSelected,
    selectedFiles,
    refresh,
    enterRoot,
    cd,
    up,
    goRoot,
    goTo,
    toggle,
    toggleAll,
    clearSelection,
    reset,
    loadRoots,
  }
}

/**
 * 文件浏览器域 HTTP 面（issue #24：随宿主提供组件五件套自宿主 useHttpApi 迁入）
 *
 * 宿主版经 `invoke('http_request')` 直连代理；插件不直连网络（前端零资源访问红线），
 * 这里经 `mobileApi.httpRequest` 走同一宿主通道（宿主 plugin/index.ts 把 useHttpApi
 * 的 httpRequest 暴露进共享运行时——JWT / 链路加密 / 错误归一化均由宿主 Rust 代理完成，
 * base URL 状态与宿主连接域同源，与 terminal/api.ts / task/api.ts 同一范式）。
 *
 * 仅保留迁移组件消费面（文件树 / 文件内容 / diff / git），宿主 useHttpApi 其余端点不随迁。
 */

import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'

/** Git diff 行数据（与宿主 useHttpApi.FileDiffLine 同构） */
export interface FileDiffLine {
  type: 'context' | 'added' | 'removed'
  content: string
  oldLineNo: number | null
  newLineNo: number | null
}

/** Git 分支列表响应 */
export interface GitBranchesData {
  currentBranch: string | null
  branches: string[]
  isGitRepo: boolean
}

/** Git 工作区状态响应 */
export interface GitStatusData {
  hasChanges: boolean
  changedCount: number
}

/** 全量获取文件树 */
export async function httpGetFileTree(sessionId: string, excludeDirs: string[] = []) {
  return getMobileApi().httpRequest<{ tree: any[] }>('/api/file-tree', {
    method: 'POST',
    body: { sessionId, excludeDirs },
  })
}

/** 获取指定目录的一层子节点（懒加载模式） */
export async function httpGetFileTreeChildren(
  sessionId: string,
  dirPath: string,
  excludeDirs: string[] = [],
  noCache = false,
) {
  const params = new URLSearchParams({
    session_id: sessionId,
    dir_path: dirPath || '.',
    exclude_dirs: excludeDirs.join(','),
  })
  // 刷新时附加时间戳绕过 HTTP 缓存
  if (noCache) {
    params.set('_t', Date.now().toString())
  }
  return getMobileApi().httpRequest<{ children: any[] }>(
    `/api/file-tree-children?${params.toString()}`,
  )
}

/** 获取文件内容 */
export async function httpGetFileContent(sessionId: string, filePath: string) {
  return getMobileApi().httpRequest<{ content: string; fileName: string }>('/api/file-content', {
    method: 'POST',
    body: { sessionId, filePath },
  })
}

/** 全量获取 diff 文件树（仅改动文件） */
export async function httpGetDiffTree(sessionId: string, excludeDirs: string[] = []) {
  return getMobileApi().httpRequest<{ tree: any[] }>('/api/diff-tree', {
    method: 'POST',
    body: { sessionId, excludeDirs },
  })
}

/** 获取单文件 diff 行 */
export async function httpGetFileDiff(sessionId: string, filePath: string) {
  return getMobileApi().httpRequest<{ fileName: string; lines: FileDiffLine[] }>('/api/file-diff', {
    method: 'POST',
    body: { sessionId, filePath },
  })
}

/** 获取 git 分支列表 */
export async function httpGetGitBranches(sessionId: string) {
  return getMobileApi().httpRequest<GitBranchesData>(
    `/api/git/branches?session_id=${encodeURIComponent(sessionId)}`,
  )
}

/** 检查工作区是否有未提交的更改 */
export async function httpGetGitStatus(sessionId: string) {
  return getMobileApi().httpRequest<GitStatusData>(
    `/api/git/status?session_id=${encodeURIComponent(sessionId)}`,
  )
}

/** 切换 git 分支 */
export async function httpGitCheckout(sessionId: string, branch: string) {
  return getMobileApi().httpRequest<{ branch: string }>('/api/git/checkout', {
    method: 'POST',
    body: { sessionId, branch },
  })
}

<script setup lang="ts">
/**
 * Skills 管理分区（票据 04）：规范库列表 + GitHub 安装 + 本地导入 + 编辑器入口
 *
 * 设计真源：原型 `.scratch/agent-hub/prototype/index.html` #a-sk（页头双动作 +
 * 状态 tag 行 + 技能表格）。规范库 `~/.agents/skills` 为真源；分发目标由
 * agent 注册表的 skills 能力派生（无目录约定的 agent 只做能力集合提示）。
 * 动作经 useSkills 单实例（AgentHubView 持有）执行，状态经
 * `plugin:bedcode:skills` 事件回流；编辑器为独立子组件（SkillEditor）。
 */
import { computed, inject, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type {
  AgentDescriptor,
  AgentHubState,
  SkillEntry,
  SkillSearchHit,
  SkillSearchResponse,
  SkillsDomainState,
} from '../types'
import type { UseSkillsReturn } from '../composables/useSkills'
import { BUILTIN_AGENTS } from '../registry'
import { formatTokens } from '../utils/format'
import {
  filterLocalSkills,
  installCommand,
  isOfficialSource,
  trustTier,
} from '../utils/skillSearch'
import SkillEditor from './SkillEditor.vue'

const props = defineProps<{
  detection: AgentHubState | null
  skills: UseSkillsReturn
  /** 注册表 agent 清单（分发目标由 skills 能力派生；缺省回退内置注册表） */
  agents?: AgentDescriptor[]
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

/** 分发目标：注册表里声明了 skills 目录的 agent（顺序同注册表） */
const targets = computed(() => (props.agents ?? BUILTIN_AGENTS).filter((a) => a.capabilities.skills))
/** 无 skills 目录约定的 agent（提示由能力集合派生，不点名具体产品） */
const skippedNames = computed(() =>
  (props.agents ?? BUILTIN_AGENTS)
    .filter((a) => !a.capabilities.skills)
    .map((a) => a.displayName),
)
const targetIds = computed(() => targets.value.map((t) => t.id))

/** fs 类动作依赖目录授权；拒绝时置灰降级（与概览/安装页同一横幅语义） */
const authGranted = computed(() => props.detection?.authGranted ?? false)

const state = computed<SkillsDomainState | null>(() => props.skills.state.value)
const scanning = computed(() => state.value?.status === 'scanning')
const importing = computed(() => state.value?.importing === true)
const busy = computed(() => scanning.value || importing.value || props.skills.githubBusy.value)

// ==================== 规范库行视图 ====================

interface SkillRow {
  entry: SkillEntry
  /** 每目标分发状态（仅 distributed/stale 出标签；全 none 时整体「仅规范库」） */
  tags: { target: string; status: 'distributed' | 'stale' }[]
}

const rows = computed<SkillRow[]>(() =>
  (state.value?.skills ?? []).map((entry) => ({
    entry,
    // 只认已分发 / 落后两种状态：持久化状态可能先于注册表变更（新增目标尚无
    // 该字段），缺字段不能当成「有标签」——旧写法 `!== 'none'` 会把 undefined
    // 也放进来，随后读 `.status` 直接崩整个页签。
    tags: targetIds.value
      .filter((t) => {
        const status = entry.distribution[t]?.status
        return status === 'distributed' || status === 'stale'
      })
      .map((t) => ({
        target: t,
        status: entry.distribution[t].status as 'distributed' | 'stale',
      })),
  })),
)

// ==================== 搜索（本地过滤 / skills.sh 联网） ====================

/** 搜索模式：local = 过滤规范库已扫出的 skill；remote = 查 skills.sh */
type SearchMode = 'local' | 'remote'
const searchMode = ref<SearchMode>('local')
const query = ref('')
const searching = ref(false)
const remoteResult = ref<SkillSearchResponse | null>(null)
const remoteError = ref<string | null>(null)
/** 联网结果安装的同名覆盖确认（与 GitHub 表单的确认条互不干扰） */
const registryPending = ref<{ source: string; skillId: string; names: string[] } | null>(null)
const registryError = ref<string | null>(null)

const localQuery = computed(() => query.value.trim())

/** 本地模式表格：按名称 / 描述 / 目录做多词 AND 过滤 */
const visibleRows = computed<SkillRow[]>(() => {
  const matched = new Set(
    filterLocalSkills(state.value?.skills ?? [], query.value).map((s) => s.dir),
  )
  return rows.value.filter((r) => matched.has(r.entry.dir))
})

function switchMode(mode: SearchMode) {
  searchMode.value = mode
  registryPending.value = null
  registryError.value = null
}

function onSearchEnter() {
  if (searchMode.value === 'remote') void runRemoteSearch()
}

/** 联网搜索：精确查询 + guest 侧逐词近似合并；网络失败落到 remoteError */
async function runRemoteSearch() {
  const q = localQuery.value
  if (!q || searching.value) return
  searching.value = true
  registryPending.value = null
  registryError.value = null
  remoteResult.value = null
  remoteError.value = null
  try {
    const r = await props.skills.searchRemote(q)
    if (r === null) {
      remoteError.value = t('hub.skill.search.failed')
      return
    }
    remoteError.value = r.error
    remoteResult.value = r
  } finally {
    searching.value = false
  }
}

/** 结果行可信度档（find-skills：≥1K 优先，<100 谨慎） */
function tierTagClass(installs: number): string {
  const tier = trustTier(installs)
  return tier === 'high' ? 'ok' : tier === 'low' ? 'warn' : ''
}

function tierText(installs: number): string {
  const tier = trustTier(installs)
  return tier === 'high'
    ? t('hub.skill.search.trustHigh')
    : tier === 'mid'
      ? t('hub.skill.search.trustMid')
      : t('hub.skill.search.trustLow')
}

/**
 * 联网结果安装：skills.sh 结果是 `owner/repo@skill`，仓库里可能有多个 skill，
 * 故携 `skill` 让 guest 只装命中的那一个（按目录名 / frontmatter name 定位）。
 */
async function installRegistry(source: string, skillId: string, force = false) {
  registryError.value = null
  const r = await props.skills.installGithub(`https://github.com/${source}`, force, skillId)
  if (r === null) {
    registryError.value = t('hub.skill.search.installFailed')
    return
  }
  if (r.exists && r.exists.length > 0) {
    registryPending.value = { source, skillId, names: r.exists }
    return
  }
  registryPending.value = null
  if (r.error) registryError.value = r.error
}

async function installHit(hit: SkillSearchHit) {
  if (props.skills.githubBusy.value) return
  await installRegistry(hit.source, hit.skillId)
}

async function confirmRegistryOverwrite() {
  const pending = registryPending.value
  if (!pending) return
  registryPending.value = null
  await installRegistry(pending.source, pending.skillId, true)
}

/** 汇总：某目标全部 distributed → 已同步；有 stale/missing → N 落后 */
function targetSummary(target: string): { status: 'ok' | 'warn' | 'neutral'; count: number } {
  const skills = state.value?.skills ?? []
  let bad = 0
  for (const s of skills) {
    if (s.distribution[target]?.status !== 'distributed') bad++
  }
  if (skills.length === 0) return { status: 'neutral', count: 0 }
  if (bad === 0) return { status: 'ok', count: 0 }
  return { status: 'warn', count: bad }
}

// ==================== GitHub 安装 ====================

const showGithubForm = ref(false)
const githubUrl = ref('')
/** 同名 skill 覆盖确认（install 返回 exists 名单后出现） */
const githubExists = ref<string[] | null>(null)
/** 不可达/失败提示（来自命令返回或状态 github.last.error） */
const githubError = ref<string | null>(null)

async function installGithub(overwrite: boolean) {
  const url = githubUrl.value.trim()
  if (!url) return
  githubExists.value = null
  githubError.value = null
  const result = await props.skills.installGithub(url, overwrite)
  if (result === null) return
  if (result.exists && result.exists.length > 0) {
    githubExists.value = result.exists
    return
  }
  if (result.installed) {
    githubExists.value = null
    githubUrl.value = ''
    showGithubForm.value = false
    return
  }
  githubError.value = result.error ?? t('hub.skill.github.failed')
}

// ==================== 本地导入 ====================

/** 目标同名 skill 覆盖确认（import 返回 exists 后出现） */
const importPending = ref<{ path: string; name: string } | null>(null)
const importAuthDenied = ref(false)

/**
 * 本地导入。语义：「有同名待确认 → 本次点击即为覆盖」——
 * 确认条上的「覆盖」按钮与导入按钮走同一个函数，前者在有 importPending 时
 * 携 `{ path, force: true }` 重入，guest 才会真正覆盖同名 skill
 * （原实现把 force 只当分支选择器、正常路径仍发 `{}`，
 *  点「覆盖」等于再问一次 exists，确认条永远消不掉）。
 */
async function importLocal() {
  importAuthDenied.value = false
  if (importPending.value) {
    const { path } = importPending.value
    importPending.value = null
    const r = await props.skills.importLocal({ path, force: true })
    handleImportResult(r)
    return
  }
  const r = await props.skills.importLocal({})
  handleImportResult(r)
}

function handleImportResult(r: Awaited<ReturnType<UseSkillsReturn['importLocal']>>) {
  if (r === null || !r.picked) return
  if (r.auth === false) {
    importAuthDenied.value = true
    return
  }
  if (r.exists && r.path && r.name) {
    importPending.value = { path: r.path, name: r.name }
    return
  }
  importPending.value = null
}

// ==================== 删除 / 卸载（规范库 + 全部分发副本） ====================

/**
 * 删除语义 = 卸载：guest 会连各目标副本一起删（否则 CLI 仍能读到孤儿副本，
 * 等于没删）。破坏性且跨目录，故走「先武装确认条、再确认」两步：行内按钮
 * 只 arm，真正的命令在确认条上发出。
 */
const deleteArmDir = ref<string | null>(null)
/** 命令被拒（未知 skill / 并发删除 / 管道失败）的行内错误；异步结果走 state.delete.last */
const deleteError = ref<string | null>(null)
/** 正在删除的目录（guest 异步进程；回灌前禁用全部删除入口） */
const deletingDir = computed(() => state.value?.deleting ?? null)
const deleteLast = computed(() => state.value?.delete?.last ?? null)

function targetName(id: string): string {
  return targets.value.find((t) => t.id === id)?.displayName ?? id
}

/** 待确认的删除目标（附已分发到的目标展示名，确认文案要点名会失效的 agent） */
const deleteArm = computed<{ entry: SkillEntry; targetNames: string[] } | null>(() => {
  if (!deleteArmDir.value) return null
  const row = rows.value.find((r) => r.entry.dir === deleteArmDir.value)
  if (!row) return null
  return { entry: row.entry, targetNames: row.tags.map((tag) => targetName(tag.target)) }
})

function armDelete(dir: string) {
  deleteError.value = null
  deleteArmDir.value = dir
}

function cancelDelete() {
  deleteArmDir.value = null
}

async function confirmDelete() {
  const dir = deleteArmDir.value
  if (!dir) return
  deleteArmDir.value = null
  deleteError.value = null
  const r = await props.skills.deleteSkill(dir)
  // 命令本身被拒：条目还在列表里，必须显性说明，不能静默吞掉
  if (!r.started) deleteError.value = r.error ?? t('hub.skill.deleteFailed')
}

// ==================== 编辑 ====================

const editingDir = ref<string | null>(null)

function openEditor(dir: string) {
  // 进编辑器前收起待确认的删除态：返回列表时不该凭空出现一条确认条
  deleteArmDir.value = null
  editingDir.value = dir
}

function closeEditor() {
  editingDir.value = null
}
</script>

<template>
  <div class="ah-sk" :class="{ 'ah-sk--editing': editingDir }" data-testid="panel-skills">
    <div v-if="!authGranted" class="ah-banner" data-testid="skills-auth">
      <span class="ah-banner-ic">⚠</span>
      <span class="ah-banner-text">{{ t('hub.auth.banner') }}</span>
    </div>

    <!-- 编辑器（替换列表视图） -->
    <SkillEditor v-if="editingDir" :skills="skills" :dir="editingDir" @close="closeEditor" />

    <template v-else>
      <div class="ah-inst-head">
        <span class="ah-section-title">{{ t('hub.tab.skills') }}</span>
        <span class="ah-speed-actions-btns">
          <button type="button" class="ah-btn ah-btn-ghost ah-btn-sm" :disabled="busy" @click="skills.scan()">
            {{ scanning ? t('hub.skill.scanning') : t('hub.skill.scan') }}
          </button>
          <button
            type="button"
            class="ah-btn ah-btn-ghost ah-btn-sm"
            :disabled="authGranted === false"
            data-testid="import-local"
            @click="importLocal()"
          >
            {{ t('hub.skill.import.action') }}
          </button>
          <button
            type="button"
            class="ah-btn ah-btn-primary ah-btn-sm"
            :disabled="authGranted === false"
            data-testid="open-github"
            @click="showGithubForm = !showGithubForm"
          >
            {{ t('hub.skill.github.action') }}
          </button>
        </span>
      </div>

      <!-- 搜索：本地过滤规范库 / skills.sh 联网搜索（find-skills 口径） -->
      <div class="ah-sk-search" data-testid="skill-search">
        <input
          v-model="query"
          class="ah-input"
          type="text"
          spellcheck="false"
          :placeholder="t('hub.skill.search.placeholder')"
          data-testid="skill-search-input"
          @keyup.enter="onSearchEnter"
        />
        <div class="ah-sk-search-modes" role="group" :aria-label="t('hub.skill.search.modeLabel')">
          <button
            type="button"
            class="ah-sk-mode-btn"
            :class="{ active: searchMode === 'local' }"
            :aria-pressed="searchMode === 'local'"
            data-testid="search-mode-local"
            @click="switchMode('local')"
          >
            {{ t('hub.skill.search.local') }}
          </button>
          <button
            type="button"
            class="ah-sk-mode-btn"
            :class="{ active: searchMode === 'remote' }"
            :aria-pressed="searchMode === 'remote'"
            data-testid="search-mode-remote"
            @click="switchMode('remote')"
          >
            {{ t('hub.skill.search.remote') }}
          </button>
        </div>
        <button
          v-if="searchMode === 'remote'"
          type="button"
          class="ah-btn ah-btn-primary ah-btn-sm"
          :disabled="searching || !localQuery"
          data-testid="search-remote-go"
          @click="runRemoteSearch()"
        >
          {{ searching ? t('hub.skill.search.searching') : t('hub.skill.search.action') }}
        </button>
      </div>
      <div class="ah-inst-hint ah-sk-search-hint" data-testid="skill-search-hint">
        {{ searchMode === 'local'
          ? t('hub.skill.search.localHint', { n: visibleRows.length, total: rows.length })
          : t('hub.skill.search.remoteHint') }}
      </div>

      <!-- 状态 tag 行（原型 #a-sk） -->
      <div class="ah-sk-status">
        <span class="ah-cli-tag">
          <span class="ah-cli-dot"></span>{{ t('hub.skill.library', { root: state?.libraryRoot ?? '', n: state?.skills.length ?? 0 }) }}
        </span>
        <span
          v-for="target in targets"
          :key="target.id"
          class="ah-cli-tag"
          :class="targetSummary(target.id).status === 'ok' ? 'ok' : targetSummary(target.id).status === 'warn' ? 'warn' : ''"
        >
          <span class="ah-cli-dot"></span>
          {{ targetSummary(target.id).status === 'ok'
            ? t('hub.skill.targetSync', { name: target.displayName })
            : targetSummary(target.id).status === 'warn'
              ? t('hub.skill.targetStale', { name: target.displayName, n: targetSummary(target.id).count })
              : t('hub.skill.targetIdle', { name: target.displayName }) }}
        </span>
        <span v-if="skippedNames.length > 0" class="ah-cli-tag">
          {{ t('hub.skill.targetNoConvention', { names: skippedNames.join(' · ') }) }}
        </span>
      </div>

      <!-- 扫描/导入失败提示 -->
      <div v-if="state?.status === 'error' && state?.error" class="ah-cli-error">
        {{ t('hub.skill.scanError') }}
      </div>

      <!-- GitHub 安装表单 -->
      <div v-if="showGithubForm" class="ah-card" data-testid="github-form">
        <div class="ah-inst-head">
          <span class="ah-section-title">{{ t('hub.skill.github.title') }}</span>
        </div>
        <div class="ah-sk-github-row">
          <input
            v-model="githubUrl"
            class="ah-input ah-mono"
            type="text"
            :placeholder="t('hub.skill.github.urlPlaceholder')"
            spellcheck="false"
            data-testid="github-url"
          />
          <button
            type="button"
            class="ah-btn ah-btn-primary ah-btn-sm"
            :disabled="busy || !githubUrl.trim()"
            @click="installGithub(false)"
          >
            {{ skills.githubBusy.value ? t('hub.skill.github.installing') : t('hub.skill.github.install') }}
          </button>
        </div>
        <div class="ah-inst-hint ah-sk-github-hint">{{ t('hub.skill.github.hint') }}</div>

        <div v-if="githubExists" class="ah-banner ah-sk-confirm">
          <span class="ah-banner-ic">⚠</span>
          <span class="ah-banner-text">{{ t('hub.skill.github.exists', { names: githubExists.join(', ') }) }}</span>
          <button type="button" class="ah-btn ah-btn-ghost ah-btn-sm" @click="installGithub(true)">
            {{ t('hub.skill.github.overwrite') }}
          </button>
        </div>

        <div v-if="githubError" class="ah-cli-error">
          {{ t('hub.skill.github.unreachable') }}
          <div class="ah-sk-raw-error">{{ githubError }}</div>
        </div>
      </div>

      <!-- 导入覆盖确认 / 授权拒绝 -->
      <div v-if="importPending" class="ah-banner ah-sk-confirm" data-testid="import-confirm">
        <span class="ah-banner-ic">⚠</span>
        <span class="ah-banner-text">{{ t('hub.skill.import.exists', { name: importPending.name }) }}</span>
        <button type="button" class="ah-btn ah-btn-ghost ah-btn-sm" @click="importLocal()">
          {{ t('hub.skill.import.overwrite') }}
        </button>
      </div>
      <div v-if="importAuthDenied" class="ah-cli-error">{{ t('hub.skill.import.authDenied') }}</div>

      <!-- 导入/GitHub 结果（guest 状态回流） -->
      <div v-if="state?.import?.last" class="ah-sk-result" :class="{ err: !state.import.last.ok }">
        {{ state.import.last.ok
          ? t('hub.skill.import.done', { name: state.import.last.name, n: state.import.last.fileCount })
          : t('hub.skill.import.failed') }}
      </div>
      <div v-if="state?.github?.last?.ok" class="ah-sk-result">
        {{ t('hub.skill.github.done', { n: state.github.last.installed.length })
          }}<template v-if="state.github.last.skippedFiles > 0"> · {{ t('hub.skill.github.skipped', { n: state.github.last.skippedFiles }) }}</template>
      </div>

      <!-- 删除 / 卸载：结果回流 + 待确认条（确认后才真的发命令） -->
      <div
        v-if="deleteLast"
        class="ah-sk-result"
        :class="{ err: !deleteLast.ok }"
        data-testid="skill-delete-result"
      >
        {{ deleteLast.ok
          ? deleteLast.targets.length > 0
            ? t('hub.skill.deleteDoneTargets', { name: deleteLast.name, n: deleteLast.targets.length })
            : t('hub.skill.deleteDone', { name: deleteLast.name })
          : t('hub.skill.deleteFailed') }}
        <div v-if="deleteLast.error" class="ah-sk-raw-error">{{ deleteLast.error }}</div>
      </div>
      <div v-if="deleteArm" class="ah-banner ah-sk-confirm" data-testid="delete-confirm">
        <span class="ah-banner-ic">⚠</span>
        <span class="ah-banner-text">
          {{ deleteArm.targetNames.length > 0
            ? t('hub.skill.deleteConfirm', {
                name: deleteArm.entry.name,
                targets: deleteArm.targetNames.join(' · '),
              })
            : t('hub.skill.deleteConfirmLibraryOnly', { name: deleteArm.entry.name }) }}
        </span>
        <button
          type="button"
          class="ah-btn ah-btn-warn ah-btn-sm"
          :disabled="deletingDir !== null"
          data-testid="delete-confirm-go"
          @click="confirmDelete()"
        >
          {{ t('hub.skill.deleteConfirmGo') }}
        </button>
        <button
          type="button"
          class="ah-btn ah-btn-ghost ah-btn-sm"
          data-testid="delete-confirm-cancel"
          @click="cancelDelete()"
        >
          {{ t('hub.skill.deleteCancel') }}
        </button>
      </div>
      <div v-if="deleteError" class="ah-cli-error" data-testid="skill-delete-error">
        {{ t('hub.skill.deleteFailed') }}
        <div class="ah-sk-raw-error">{{ deleteError }}</div>
      </div>

      <!-- 空态（本地库为空） / 无本地命中 -->
      <div v-if="searchMode === 'local' && !scanning && rows.length === 0" class="ah-card ah-sk-empty">
        <div class="ah-section-title">{{ t('hub.skill.empty') }}</div>
        <div class="ah-inst-hint ah-sk-empty-hint">{{ t('hub.skill.emptyHint') }}</div>
      </div>
      <div
        v-if="searchMode === 'local' && !scanning && rows.length > 0 && visibleRows.length === 0"
        class="ah-card ah-sk-empty"
        data-testid="skill-search-no-match"
      >
        <div class="ah-section-title">{{ t('hub.skill.search.noMatch', { q: localQuery }) }}</div>
        <div class="ah-inst-hint ah-sk-empty-hint">{{ t('hub.skill.search.noMatchHint') }}</div>
      </div>

      <!-- 联网搜索结果（skills.sh） -->
      <template v-if="searchMode === 'remote'">
        <div v-if="searching" class="ah-card ah-sk-empty" data-testid="search-loading">
          <div class="ah-section-title">{{ t('hub.skill.search.searching') }}</div>
          <div class="ah-inst-hint ah-sk-empty-hint">{{ t('hub.skill.search.remoteHint') }}</div>
        </div>
        <div v-else-if="remoteError" class="ah-cli-error" data-testid="search-error">
          {{ t('hub.skill.search.failed') }}
          <div class="ah-sk-raw-error">{{ remoteError }}</div>
        </div>
        <div v-else-if="!remoteResult" class="ah-card ah-sk-empty" data-testid="search-idle">
          <div class="ah-section-title">{{ t('hub.skill.search.remoteIdle') }}</div>
          <div class="ah-inst-hint ah-sk-empty-hint">{{ t('hub.skill.search.remoteHint') }}</div>
        </div>
        <div
          v-else-if="remoteResult.results.length === 0"
          class="ah-card ah-sk-empty"
          data-testid="search-empty"
        >
          <div class="ah-section-title">{{ t('hub.skill.search.remoteEmpty', { q: remoteResult.query }) }}</div>
          <div class="ah-inst-hint ah-sk-empty-hint">{{ t('hub.skill.search.remoteEmptyHint') }}</div>
        </div>
        <div v-else class="ah-card ah-sk-table-card" data-testid="search-results">
          <div class="ah-sk-search-meta">
            <span>{{ t('hub.skill.search.count', { n: remoteResult.results.length, q: remoteResult.query }) }}</span>
            <span v-if="remoteResult.fallback" class="ah-cli-tag" data-testid="search-fallback">
              {{ t('hub.skill.search.fallback') }}
            </span>
          </div>
          <div
            v-for="hit in remoteResult.results"
            :key="hit.id"
            class="ah-sk-row"
            :data-testid="`search-result-${hit.id}`"
          >
            <div class="ah-sk-row-main">
              <span class="ah-sk-row-name">
                <span class="ah-sk-row-name-text">{{ hit.name }}</span>
                <span class="ah-mono ah-sk-row-dir">{{ hit.source }}</span>
              </span>
              <span class="ah-sk-row-desc ah-mono">{{ installCommand(hit) }}</span>
              <span class="ah-sk-row-desc ah-mono">{{ hit.url }}</span>
            </div>
            <div class="ah-sk-row-dist">
              <span class="ah-cli-tag" :class="tierTagClass(hit.installs)">
                <span class="ah-cli-dot"></span>{{ tierText(hit.installs) }}
              </span>
              <span class="ah-cli-tag">{{ t('hub.skill.search.installs', { n: formatTokens(hit.installs) }) }}</span>
              <span v-if="isOfficialSource(hit.source)" class="ah-cli-tag ok">
                {{ t('hub.skill.search.official') }}
              </span>
            </div>
            <div class="ah-sk-row-actions">
              <button
                type="button"
                class="ah-btn ah-btn-primary ah-btn-sm"
                :disabled="authGranted === false || props.skills.githubBusy.value"
                :data-testid="`search-install-${hit.id}`"
                @click="installHit(hit)"
              >
                {{ props.skills.githubBusy.value
                  ? t('hub.skill.github.installing')
                  : t('hub.skill.search.install') }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="registryPending" class="ah-banner ah-sk-confirm" data-testid="registry-confirm">
          <span class="ah-banner-ic">⚠</span>
          <span class="ah-banner-text">{{ t('hub.skill.github.exists', { names: registryPending.names.join(', ') }) }}</span>
          <button type="button" class="ah-btn ah-btn-ghost ah-btn-sm" @click="confirmRegistryOverwrite()">
            {{ t('hub.skill.github.overwrite') }}
          </button>
        </div>
        <div v-if="registryError" class="ah-cli-error" data-testid="registry-error">
          {{ t('hub.skill.search.installFailed') }}
          <div class="ah-sk-raw-error">{{ registryError }}</div>
        </div>
      </template>

      <!-- 技能表格（原型：技能 | 描述 | 分发状态 | 动作） -->
      <div v-if="searchMode === 'local' && visibleRows.length > 0" class="ah-card ah-sk-table-card">
        <div v-for="row in visibleRows" :key="row.entry.dir" class="ah-sk-row" :data-testid="`skill-row-${row.entry.dir}`">
          <div class="ah-sk-row-main">
            <span class="ah-sk-row-name">
              <span class="ah-sk-row-name-text">{{ row.entry.name }}</span>
              <span class="ah-mono ah-sk-row-dir">{{ row.entry.dir }}</span>
            </span>
            <span class="ah-sk-row-desc" :title="row.entry.description ?? ''">
              {{ row.entry.description ?? '' }}
            </span>
          </div>
          <div class="ah-sk-row-dist">
            <span v-if="row.tags.length === 0" class="ah-cli-tag">
              <span class="ah-cli-dot"></span>{{ t('hub.skill.status.libraryOnly') }}
            </span>
            <span
              v-for="tag in row.tags"
              :key="tag.target"
              class="ah-cli-tag"
              :class="tag.status === 'distributed' ? 'ok' : 'warn'"
            >
              <span class="ah-cli-dot"></span>
              {{ tag.status === 'distributed'
                ? t('hub.skill.status.synced', { name: tag.target })
                : t('hub.skill.status.stale', { name: tag.target }) }}
            </span>
          </div>
          <div class="ah-sk-row-actions">
            <button
              type="button"
              class="ah-btn ah-btn-ghost ah-btn-sm"
              :disabled="deletingDir !== null"
              :data-testid="`edit-${row.entry.dir}`"
              @click="openEditor(row.entry.dir)"
            >
              {{ t('hub.skill.edit') }}
            </button>
            <button
              type="button"
              class="ah-btn ah-btn-sm"
              :class="row.tags.some((x) => x.status === 'stale') || row.tags.length === 0 ? 'ah-btn-primary' : 'ah-btn-ghost'"
              :disabled="busy || deletingDir !== null || props.skills.distributing.value !== null || !authGranted"
              :data-testid="`distribute-${row.entry.dir}`"
              @click="skills.distribute(row.entry.dir)"
            >
              {{ props.skills.distributing.value === row.entry.dir
                ? t('hub.skill.distributing')
                : row.tags.length === 0
                  ? t('hub.skill.distribute')
                  : row.tags.some((x) => x.status === 'stale')
                    ? t('hub.skill.redistribute')
                    : t('hub.skill.distribute') }}
            </button>
            <button
              type="button"
              class="ah-btn ah-btn-ghost ah-btn-sm"
              :class="{ 'ah-btn-warn': deleteArmDir === row.entry.dir }"
              :disabled="busy || deletingDir !== null || !authGranted"
              :data-testid="`delete-${row.entry.dir}`"
              @click="armDelete(row.entry.dir)"
            >
              {{ deletingDir === row.entry.dir ? t('hub.skill.deleting') : t('hub.skill.delete') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

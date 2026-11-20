<template>
  <div class="h-full min-h-0 flex" data-testid="project-files-workspace">
    <div
      class="wb-files-tree shrink-0 min-h-0 flex flex-col border-r border-[var(--border)]"
      data-testid="workspace-file-tree"
    >
      <ProjectFileTree
        :project-id="projectId"
        :working-dir="workingDir"
        :active="active"
        @open="openTab"
      />
    </div>

    <div class="min-w-0 min-h-0 flex-1 flex flex-col">
      <template v-if="tabs.length > 0">
        <div
          class="h-9 shrink-0 flex items-stretch border-b border-[var(--border)] bg-[var(--bg-card)]"
        >
          <div
            ref="tabListEl"
            class="wb-file-tabs min-w-0 flex-1 flex items-stretch overflow-x-auto"
            role="tablist"
            :aria-label="t('project.files.tabs')"
          >
            <div
              v-for="(tab, index) in tabs"
              :id="tabId(index)"
              :key="tab.path"
              class="wb-file-tab"
              role="tab"
              :aria-selected="tab.path === activePath"
              :tabindex="tab.path === activePath ? 0 : -1"
              :title="tab.path"
              :data-path="tab.path"
              data-testid="file-tab"
              @click="activateTab(tab.path)"
              @keydown="onTabKeydown($event, index)"
              @keydown.enter.prevent="activateTab(tab.path)"
              @keydown.space.prevent="activateTab(tab.path)"
            >
              <span class="min-w-0 truncate">{{ tab.name }}</span>
              <button
                type="button"
                class="wb-file-tab-close"
                :title="t('project.files.closeTab', { name: tab.name })"
                :aria-label="t('project.files.closeTab', { name: tab.name })"
                data-testid="file-tab-close"
                @click.stop="closeTab(tab.path)"
                @keydown.stop
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.75"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 relative">
          <div
            v-for="(tab, index) in tabs"
            :id="panelId(index)"
            :key="tab.path"
            class="absolute inset-0"
            role="tabpanel"
            :aria-labelledby="tabId(index)"
            :hidden="tab.path !== activePath"
            data-testid="file-tab-panel"
          >
            <ProjectFileTabPane
              :project-id="projectId"
              :path="tab.path"
              :active="tab.path === activePath"
            />
          </div>
        </div>
      </template>

      <div
        v-else
        class="flex-1 min-h-0 flex flex-col items-center justify-center px-6 text-center"
        data-testid="project-files-empty"
      >
        <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
          {{ t('project.files.openHint') }}
        </p>
        <p
          class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
        >
          {{ t('project.files.openHintDetail') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, nextTick, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import ProjectFileTree from './ProjectFileTree.vue'
import ProjectFileTabPane from './ProjectFileTabPane.vue'

interface FileTab {
  name: string
  path: string
}

const props = defineProps<{
  projectId: string
  workingDir: string
  active: boolean
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const tabs = ref<FileTab[]>([])
const activePath = ref('')
const tabListEl = ref<HTMLElement | null>(null)

function tabId(index: number): string {
  return `wb-file-tab-${index}`
}

function panelId(index: number): string {
  return `wb-file-tab-panel-${index}`
}

function activateTab(path: string): void {
  if (!tabs.value.some((tab) => tab.path === path)) return
  activePath.value = path
}

function openTab(name: string, path: string): void {
  if (!path) return
  if (!tabs.value.some((tab) => tab.path === path)) {
    tabs.value.push({ name: name || path.split('/').pop() || path, path })
  }
  activePath.value = path
}

function closeTab(path: string): void {
  const index = tabs.value.findIndex((tab) => tab.path === path)
  if (index < 0) return
  const wasActive = activePath.value === path
  tabs.value.splice(index, 1)
  if (!wasActive && tabs.value.length > 0) {
    void focusActiveTab()
    return
  }
  activePath.value = tabs.value[index]?.path ?? tabs.value[index - 1]?.path ?? ''
  if (activePath.value) void focusActiveTab()
}

async function revealActiveTab(): Promise<void> {
  await nextTick()
  const el = tabListEl.value?.querySelector<HTMLElement>(
    '[data-testid="file-tab"][aria-selected="true"]',
  )
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

async function focusActiveTab(): Promise<void> {
  await nextTick()
  const el = tabListEl.value?.querySelector<HTMLElement>(
    '[data-testid="file-tab"][aria-selected="true"]',
  )
  el?.focus()
}

function onTabKeydown(event: KeyboardEvent, index: number): void {
  if (event.target !== event.currentTarget) return
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  let next = index
  if (event.key === 'ArrowLeft') next = (index - 1 + tabs.value.length) % tabs.value.length
  else if (event.key === 'ArrowRight') next = (index + 1) % tabs.value.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.value.length - 1
  const target = tabs.value[next]
  if (!target) return
  activateTab(target.path)
  void nextTick().then(() => {
    const nodes = tabListEl.value?.querySelectorAll<HTMLElement>('[data-testid="file-tab"]')
    nodes?.[next]?.focus()
  })
}

watch(activePath, () => {
  void revealActiveTab()
})

watch(
  () => props.projectId,
  () => {
    tabs.value = []
    activePath.value = ''
  },
)
</script>

<style scoped>
.wb-files-tree {
  width: clamp(160px, 26%, 280px);
}

.wb-file-tabs {
  scrollbar-width: thin;
  scroll-padding-inline: 0.5rem;
}

.wb-file-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
  max-width: 14rem;
  height: 100%;
  padding: 0 0.375rem 0 0.75rem;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  font-size: calc(11.5px * var(--ui-scale));
}

.wb-file-tab:hover {
  background: var(--bg-hover);
}

.wb-file-tab[aria-selected='true'] {
  color: var(--text-primary);
  background: var(--bg-page);
}

.wb-file-tab[aria-selected='true']::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  border-bottom: 2px solid var(--color-primary);
}

.wb-file-tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.wb-file-tab-close {
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.wb-file-tab-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.wb-file-tab-close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
</style>

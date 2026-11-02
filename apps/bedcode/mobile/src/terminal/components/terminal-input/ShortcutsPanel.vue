<template>
  <!-- 快捷键面板遮罩 - 点击终端区域关闭面板 -->
  <transition name="shortcuts-overlay">
    <div
      v-if="visible && !isLandscape"
      class="shortcuts-overlay"
      @touchstart.prevent="requestClose"
      @mousedown.prevent="requestClose"
    ></div>
  </transition>

  <!-- 快捷键面板 - 覆盖层，不影响终端高度 -->
  <transition name="shortcuts-slide">
    <div v-if="visible && !isLandscape" ref="panelRef" class="shortcuts-panel" @mousedown.prevent>
      <!-- 轮播容器：页序由 `slides` 派生（首尾各一个克隆），页面标记每类只写一份 -->
      <div
        ref="carouselRef"
        class="carousel-container"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
      >
        <div class="carousel-track" :style="trackStyle">
          <div v-for="(slide, slideIndex) in slides" :key="slideIndex" class="carousel-slide">
            <!-- 命令页（含首尾克隆） -->
            <div v-if="slide.key === 'commands'" class="custom-commands-layout">
              <div class="custom-commands-grid">
                <button
                  v-for="cmd in displayCommands"
                  :key="cmd.id"
                  class="custom-cmd-btn"
                  :class="{ editing: isEditingCommands }"
                  @click="handleCustomCommandClick(cmd)"
                >
                  <span class="cmd-label">{{ cmd.command }}</span>
                  <transition name="delete-badge">
                    <button
                      v-if="isEditingCommands && !cmd.builtin"
                      class="cmd-delete-btn"
                      @click.stop="$emit('delete', cmd.id)"
                    >
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </transition>
                </button>

                <!-- 编辑/完成按钮 -->
                <button
                  v-if="customCommands.length > 0"
                  class="custom-cmd-btn edit-toggle-btn"
                  @click="isEditingCommands = !isEditingCommands"
                >
                  <svg
                    v-if="!isEditingCommands"
                    class="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                  <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </button>

                <!-- 添加按钮 -->
                <button class="custom-cmd-btn add-cmd-btn" @click="startAddCommand">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2.5"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- 快捷键页（含首尾克隆）：左侧网格 | 中间 Enter/Del | 右侧方向键 -->
            <div v-else class="shortcuts-layout">
              <div class="shortcuts-left">
                <div class="shortcuts-grid">
                  <button
                    v-for="key in leftShortcuts"
                    :key="key.code"
                    class="shortcut-btn"
                    @click="$emit('shortcut', key.code)"
                  >
                    {{ key.label }}
                  </button>
                </div>
              </div>

              <div v-if="isEnterVisible || isDelVisible" class="shortcuts-center">
                <div class="action-keys-layout">
                  <button
                    v-if="isEnterVisible"
                    class="action-btn action-btn--enter"
                    @click="$emit('shortcut', 'enter')"
                  >
                    Enter
                  </button>
                  <button
                    v-if="isDelVisible"
                    class="action-btn action-btn--del"
                    @click="$emit('shortcut', 'backspace')"
                  >
                    Del
                  </button>
                </div>
              </div>

              <div class="shortcuts-right">
                <div class="arrow-keys-layout">
                  <div class="arrow-row">
                    <div class="arrow-placeholder"></div>
                    <button class="arrow-btn" @click="$emit('shortcut', 'arrow_up')">
                      <svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.5"
                          d="M5 15l7-7 7 7"
                        />
                      </svg>
                    </button>
                    <div class="arrow-placeholder"></div>
                  </div>
                  <div class="arrow-row">
                    <button class="arrow-btn" @click="$emit('shortcut', 'arrow_left')">
                      <svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.5"
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>
                    <button class="arrow-btn arrow-down" @click="$emit('shortcut', 'arrow_down')">
                      <svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.5"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>
                    <button class="arrow-btn" @click="$emit('shortcut', 'arrow_right')">
                      <svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.5"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 页码指示器 -->
      <div class="carousel-dots">
        <div
          v-for="(page, index) in PAGES"
          :key="page.key"
          class="dot"
          :class="{ active: displaySlide === index }"
          @click="goToSlide(index)"
        ></div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
/**
 * 终端快捷键面板（issue #19 从 TerminalInputBar 拆出）
 *
 * 结构：
 * - 循环轮播的页序由 `PAGES` 派生为 `[末页克隆, ...PAGES, 首页克隆]`，
 *   快捷键页 / 命令页的标记各只写一份——旧实现把两页整段复制（4 份标记），
 *   改一处要同步四处。
 * - 手势 / 索引 / 循环跳转在 `useCarousel`（可独立单测）。
 * - 组件只发语义事件（shortcut / command / delete / add），频次记账与终端
 *   输入由父组件负责；高度经 `height` 事件交回父组件同步终端偏移。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useInputAssistantStore, type QuickCommand } from '../../inputAssistant'
import { useCarousel } from '../../composables/useCarousel'

defineOptions({ name: 'TerminalShortcutsPanel' })

const props = defineProps<{
  visible: boolean
  isLandscape: boolean
  customCommands: QuickCommand[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  shortcut: [code: string]
  command: [command: QuickCommand]
  delete: [id: string]
  add: []
  height: [height: number]
}>()

/** 面板页序：真实页顺序即产品顺序，克隆位由 slides 派生（唯一真源） */
const PAGES = [{ key: 'shortcuts' }, { key: 'commands' }] as const
const FIRST_PAGE = PAGES[0]
const LAST_PAGE = PAGES[PAGES.length - 1]

const slides = computed(() => [LAST_PAGE, ...PAGES, FIRST_PAGE])

const assistStore = useInputAssistantStore()
const panelRef = ref<HTMLElement | null>(null)
const carouselRef = ref<HTMLElement | null>(null)

const { displaySlide, trackStyle, goToSlide, onTouchStart, onTouchMove, onTouchEnd } = useCarousel({
  totalSlides: PAGES.length,
  container: carouselRef,
})

const leftShortcuts = computed(() => assistStore.visiblePanelShortcuts)
const isEnterVisible = computed(
  () => assistStore.shortcutConfig.find((s) => s.code === 'enter')?.visible ?? true,
)
const isDelVisible = computed(
  () => assistStore.shortcutConfig.find((s) => s.code === 'backspace')?.visible ?? true,
)

/** 面板命令 = 命令预设（builtin，在前） + 用户自定义命令 */
const displayCommands = computed(() => [...assistStore.presetCommands, ...props.customCommands])

const isEditingCommands = ref(false)

// 自定义命令被删空后自动退出编辑态（与旧实现一致：空列表没有可编辑对象）
watch(
  () => props.customCommands.length,
  (length) => {
    if (length === 0) isEditingCommands.value = false
  },
)

function handleCustomCommandClick(cmd: QuickCommand) {
  if (isEditingCommands.value) return
  emit('command', cmd)
}

function startAddCommand() {
  isEditingCommands.value = false
  emit('add')
}

function requestClose() {
  emit('update:visible', false)
}

/** 面板高度变化（打开后测量 / 关闭立即归零）→ 父组件同步终端偏移 */
watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      emit('height', 0)
      return
    }
    await nextTick()
    emit('height', panelRef.value?.offsetHeight || 0)
  },
)
</script>

<style scoped>
/* ==================== Carousel ==================== */

.shortcuts-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  border-bottom: 1px solid var(--mobile-border);
  padding: 0.5rem 0.75rem 0.375rem;
  background: var(--mobile-bg-secondary);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.15);
  z-index: 30;
  max-width: 100vw;
  overflow: visible;
  box-sizing: border-box;
  /*
   * 固定高度 = padding + 2行按钮 + dots
   * padding-top: 0.5rem, padding-bottom: 0.375rem
   * 内容区: 2*btn-h + gap(0.375rem) + dots(padding-top 0.375rem + dot 0.375rem)
   */
  --panel-h: calc(0.5rem + 2 * var(--shortcut-btn-h) + 0.375rem + 0.75rem + 0.375rem);
  height: var(--panel-h);
  min-height: var(--panel-h);
  max-height: var(--panel-h);
}

/* 快捷键面板遮罩 - 覆盖终端区域，点击关闭面板 */
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  z-index: 29;
}

.shortcuts-overlay-enter-active,
.shortcuts-overlay-leave-active {
  transition: opacity 0.2s ease;
}

.shortcuts-overlay-enter-from,
.shortcuts-overlay-leave-to {
  opacity: 0;
}

/* 快捷键面板滑动动画 - 从下往上展开/收起 */
.shortcuts-slide-enter-active,
.shortcuts-slide-leave-active {
  transition:
    transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s ease;
}

.shortcuts-slide-enter-from,
.shortcuts-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

.shortcuts-slide-enter-to,
.shortcuts-slide-leave-from {
  transform: translateY(0);
  opacity: 1;
}

.carousel-container {
  overflow-x: hidden;
  overflow-y: visible;
  max-width: 100%;
  height: calc(2 * var(--shortcut-btn-h) + 0.375rem);
}

.carousel-track {
  display: flex;
  will-change: transform;
  /* 固定高度，防止被内容撑开 */
  height: calc(2 * var(--shortcut-btn-h) + 0.375rem);
}

/* 每页轮播固定宽高，绝不超出 */
.carousel-slide {
  width: 100%;
  height: calc(2 * var(--shortcut-btn-h) + 0.375rem);
  overflow: visible;
  box-sizing: border-box;
  flex-shrink: 0;
}

.carousel-dots {
  display: flex;
  justify-content: center;
  gap: 0.375rem;
  padding-top: 0.375rem;
}

.dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: var(--mobile-border);
  transition: all 0.3s ease;
  cursor: pointer;
}

.dot.active {
  background: var(--mobile-accent);
  width: 1rem;
}

/* ==================== Shortcuts (Slide 1) ==================== */

/* grid 布局：左侧自适应 | 中间固定 | 右侧固定 */
.shortcuts-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.5rem;
  align-items: stretch;
  /* 固定 2 行高度 */
  height: calc(2 * var(--shortcut-btn-h) + 0.375rem);
  width: 100%;
  max-width: 100%;
  overflow: visible;
  box-sizing: border-box;
}

/* 左侧：占满剩余宽度，固定2行高度，超出可滚动 */
.shortcuts-left {
  min-width: 0;
  height: calc(2 * var(--shortcut-btn-h) + 0.375rem);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
}

.shortcuts-left::-webkit-scrollbar {
  display: none;
  width: 0;
}

.shortcuts-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.shortcut-btn {
  height: var(--shortcut-btn-h);
  padding: 0 0.5rem;
  white-space: nowrap;
  min-width: var(--shortcut-min-w);
  background: var(--mobile-shortcut-bg);
  border: 1px solid var(--mobile-shortcut-border);
  color: var(--mobile-shortcut-color);
  font-size: var(--shortcut-font);
  font-weight: 500;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.shortcut-btn:active {
  transform: scale(0.95);
  background: var(--mobile-shortcut-active-bg);
}

/* 中间：Enter/Del，固定宽度 */
.shortcuts-center {
  display: flex;
  align-items: center;
}

.action-keys-layout {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.action-btn {
  width: var(--action-btn-w);
  height: var(--shortcut-btn-h);
  font-size: var(--shortcut-font);
  font-weight: 600;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid;
}

.action-btn--enter {
  background: var(--mobile-confirm-bg);
  border-color: var(--mobile-confirm-border);
  color: var(--mobile-confirm-color);
}

.action-btn--enter:active {
  transform: scale(0.95);
  filter: brightness(1.2);
}

.action-btn--del {
  background: var(--mobile-danger-bg);
  border-color: var(--mobile-danger-border);
  color: var(--mobile-danger-color);
}

.action-btn--del:active {
  transform: scale(0.95);
  filter: brightness(1.2);
}

/* 右侧：方向键，固定宽度 */
.shortcuts-right {
}

.arrow-keys-layout {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.arrow-row {
  display: flex;
  gap: 0.375rem;
  justify-content: center;
}

.arrow-placeholder {
  width: 2.5rem;
  height: var(--shortcut-btn-h);
}

.arrow-btn {
  width: 2.5rem;
  height: var(--shortcut-btn-h);
  background: var(--mobile-arrow-bg);
  border: 1px solid var(--mobile-arrow-border);
  color: var(--mobile-arrow-color);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.arrow-btn:active {
  transform: scale(0.9);
  background: var(--mobile-arrow-active-bg);
}

.arrow-icon {
  width: 0.875rem;
  height: 0.875rem;
}

/* ==================== Custom Commands (Slide 2) ==================== */

.custom-commands-layout {
  width: 100%;
  height: calc(2 * var(--shortcut-btn-h) + 0.375rem);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
}

.custom-commands-layout::-webkit-scrollbar {
  display: none;
  width: 0;
}

.custom-commands-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.custom-cmd-btn {
  padding: 0 0.5rem;
  white-space: nowrap;
  min-width: var(--shortcut-min-w);
  height: var(--shortcut-btn-h);
  background: var(--mobile-custom-cmd-bg);
  border: 1px solid var(--mobile-custom-cmd-border);
  color: var(--mobile-custom-cmd-color);
  font-size: var(--shortcut-font);
  font-weight: 500;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 0 0.25rem;
}

.custom-cmd-btn:active {
  transform: scale(0.95);
  background: var(--mobile-custom-cmd-active-bg);
}

.cmd-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* 编辑模式下按钮抖动提示 */
.custom-cmd-btn.editing {
  animation: wiggle 0.3s ease-in-out;
  border-color: var(--mobile-danger-border);
  background: var(--mobile-danger-bg);
  color: var(--mobile-danger-color);
}

@keyframes wiggle {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-2deg);
  }
  75% {
    transform: rotate(2deg);
  }
}

.cmd-delete-btn {
  position: absolute;
  top: -0.25rem;
  right: -0.25rem;
  width: 1rem;
  height: 1rem;
  background: var(--mobile-danger-solid-bg);
  border: none;
  border-radius: 9999px;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* 删除徽章过渡动画 */
.delete-badge-enter-active {
  transition: all 0.2s ease-out;
}
.delete-badge-leave-active {
  transition: all 0.15s ease-in;
}
.delete-badge-enter-from,
.delete-badge-leave-to {
  opacity: 0;
  transform: scale(0.5);
}

/* 编辑切换按钮 */
.edit-toggle-btn {
  background: var(--mobile-edit-cmd-bg);
  border: 1px solid var(--mobile-edit-cmd-border);
  color: var(--mobile-edit-cmd-color);
}

.edit-toggle-btn:active {
  transform: scale(0.95);
  background: var(--mobile-edit-cmd-active-bg);
}

/* 添加按钮 */
.add-cmd-btn {
  background: var(--mobile-add-cmd-bg);
  border: 1px dashed var(--mobile-add-cmd-border);
  color: var(--mobile-add-cmd-color);
}

.add-cmd-btn:active {
  transform: scale(0.95);
  background: var(--mobile-add-cmd-active-bg);
}
</style>

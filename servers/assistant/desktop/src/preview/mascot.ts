/**
 * 形象六态预览
 *
 * 只用于截图验收：把六种状态并排渲染，可关闭标签（供无文字辨识）与动效。
 */
import { createApp, h } from 'vue'
import NestMascot from '@nest-shared/components/NestMascot.vue'
import type { MascotState } from '@nest-shared/ui/mascot-state'
import '@wasmnest/desktop-styles/style.css'

const params = new URLSearchParams(location.search)
const motionEnabled = params.get('motion') !== 'off'
const showLabels = params.get('labels') !== '0'

const states: MascotState[] = ['idle', 'thinking', 'streaming', 'tooling', 'error', 'locked']

createApp({
  render: () =>
    h(
      'div',
      { class: 'grid' },
      states.map((state) =>
        h('div', { class: 'cell', 'data-state': state }, [
          h(NestMascot, { state, size: 96, motionEnabled }),
          showLabels ? h('span', { class: 'label' }, state) : null,
        ]),
      ),
    ),
}).mount('#app')
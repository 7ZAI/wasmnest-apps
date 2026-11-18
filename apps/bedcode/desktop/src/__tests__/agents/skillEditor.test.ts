/**
 * SkillEditor 装载失败态（2026-11-15 实机教训）
 *
 * 背景：`agent.read-skill` 失败时 `readSkill` 返回 null，编辑器原实现只在
 * `v-else-if="detail"` 为真时渲染主体——detail 为 null 就整块不渲染，界面只剩
 * 标题栏与返回按钮，用户分不清「命令失败」与「内容空白」。
 *
 * 契约（fail-visible）：装载失败必须给可见原因 + 重试入口；重试成功即可直接进入
 * 编辑态（不需要退回列表重来）。断言只用外部可见行为：data-testid 与发往
 * guest 的调用次数，不测组件内部状态。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import SkillEditor from '../../agents/components/SkillEditor.vue'
import type { UseSkillsReturn } from '../../agents/composables/useSkills'
import type { SkillDetail } from '../../agents/types'

/** i18n 桩直返 key（插值参数渲染出来，断言不依赖文案真值） */
function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: {
      t: (k: string, params?: Record<string, unknown>) =>
        params && Object.keys(params).length > 0
          ? `${k}(${Object.entries(params)
              .map(([pk, pv]) => `${pk}=${String(pv)}`)
              .join(',')})`
          : k,
      getI18n: () => ({ global: { t: (k: string) => k } }),
    },
    commands: { execute: vi.fn(async () => null) },
    events: { on: () => ({ dispose: () => {} }) },
  } as unknown as PluginContext
}

/** SkillEditor 只消费 readSkill / saveSkill；其余域字段给最小替身 */
function skillsStub(over: Partial<UseSkillsReturn> = {}): UseSkillsReturn {
  return {
    state: ref(null),
    githubBusy: ref(false),
    distributing: ref(null),
    readSkill: vi.fn(async () => null),
    saveSkill: vi.fn(async () => ({ saved: false })),
    ...over,
  } as unknown as UseSkillsReturn
}

function mountEditor(skills: UseSkillsReturn, dir = 'ctx7') {
  return mount(
    SkillEditor as never,
    {
      props: { dir, skills },
      global: { provide: { pluginContext: makeContext() } },
    } as never,
  )
}

const detail = (content: string): SkillDetail => ({
  dir: 'ctx7',
  name: 'ctx7',
  description: null,
  allowedTools: null,
  content,
})

describe('SkillEditor：装载失败显性提示 + 重试', () => {
  it('read-skill 返回 null：出错误条与重试按钮，不渲染编辑区 / 保存按钮', async () => {
    const w = mountEditor(skillsStub())
    await flushPromises()

    expect(w.get('[data-testid="skill-load-error"]').text()).toContain(
      'hub.skill.editor.loadFailed',
    )
    expect(w.find('[data-testid="skill-load-retry"]').exists()).toBe(true)
    // 无草稿可存：编辑区与保存按钮都不该出现（避免「点了保存但没内容」）
    expect(w.find('[data-testid="markdown-textarea"]').exists()).toBe(false)
    expect(w.find('[data-testid="skill-save"]').exists()).toBe(false)
    w.unmount()
  })

  it('重试成功：错误条消失，正文回填并可直接继续编辑', async () => {
    const readSkill = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detail('---\nname: ctx7\n---\n\n# Body'))
    const w = mountEditor(skillsStub({ readSkill }))
    await flushPromises()
    expect(w.find('[data-testid="skill-load-error"]').exists()).toBe(true)

    await w.get('[data-testid="skill-load-retry"]').trigger('click')
    await flushPromises()

    expect(readSkill).toHaveBeenCalledTimes(2)
    expect(readSkill).toHaveBeenLastCalledWith('ctx7')
    expect(w.find('[data-testid="skill-load-error"]').exists()).toBe(false)
    expect(
      (w.get('[data-testid="markdown-textarea"]').element as HTMLTextAreaElement).value,
    ).toContain('# Body')
    w.unmount()
  })
})

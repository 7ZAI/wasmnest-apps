/**
 * 桌面端 dev-shell 兼容出口
 *
 * 只导出演示种子，供平台开发环境识别；真实宿主加载的是 `src/entry.ts`
 * 挂载包，不会读取本文件。
 */
export const devMock = {
  assistant: {
    demo: true,
  },
}
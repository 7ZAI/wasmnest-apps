/**
 * WasmNest 插件前端共享状态
 *
 * 终端工具栏按钮（index.ts 注册）与任务队列弹窗（TaskQueueModal.vue）之间共享可见性。
 * 模块级 ref 在插件 bundle 的单个实例内共享（每个 webview 独立加载 bundle）。
 */
import { ref } from 'vue'

/** 任务队列弹窗是否可见 */
export const taskModalVisible = ref(false)

/**
 * 任务队列弹窗的目标会话（空串 = 按路由取，终端窗口/会话页的既有行为）
 *
 * 项目工作台没有「终端窗口路由」，同一弹窗要能指向中栏当前选中的运行；
 * 打开前写入本 ref，弹窗优先用它，避免为了一个参数复制第二份弹窗。
 */
export const taskModalSessionId = ref('')

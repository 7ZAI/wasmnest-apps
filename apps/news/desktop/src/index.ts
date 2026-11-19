/**
 * News 前端 dev-shell 兼容出口
 *
 * 桌面主宿主只装载 `src/entry.ts`（mountApp）；本文件仅保留 dev-shell 按旧协议
 * 读取的 `devMock` 出口。
 */
import devMock from './devMock'

export { devMock }
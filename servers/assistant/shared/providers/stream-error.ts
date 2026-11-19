/**
 * 流映射错误基类（票 10）
 *
 * 三家方言的 SSE → pi 事件映射器共用同一错误基类：StreamFn 只认这一个
 * 类型做「点名失败原因」的编码（协议 error 事件），不感知具体方言。
 * 各方言映射器抛自己的子类，保留方言语境（错误文案可点名方言细节）。
 */
export class StreamMapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamMapError'
  }
}

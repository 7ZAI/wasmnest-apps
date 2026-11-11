#!/usr/bin/env node
/**
 * 离线扫码命中率基准（票 2026-11-11，spec §6.1）
 * -----------------------------------------------------------------------------
 * 用生产代码跑「桌面扫码 → 相机退化 → 移动端解码策略」的端到端命中率：
 *
 * ```text
 * 桌面 pairingPayload / qrRender          → 真实 v2 载荷与矩阵
 * 1080p 传感器渲染 + 高斯模糊 + 降采样     → 模拟相机（见 bench 模块头注）
 * 移动 scan/decodeStrategy + zxingDecoder → 生产尝试序列（含旋转轮换）
 * ```
 *
 * 不需要真机 / 网络，纯本地：`pnpm run bench:qr`（或 `node scripts/qr-decode-bench.mjs`）。
 * CI 的阈值断言在 `apps/bedcode/mobile/src/host/__tests__/qrDecodeBench.test.ts`，
 * 与本脚本共用同一份 `runDecodeBench`，不在 CI 里跑额外 CLI。
 *
 * 参数：
 *   --payloads <n>  载荷数（默认 20）
 *   --frames <n>    每样本连续扫描帧数（默认 4）
 *   --json          输出机器可读 JSON
 *
 * 注意：本脚本会 import 仓库内的 `.ts` 源码（含桌面 `qrRender`），依赖 Node ≥ 22.18
 * 的默认类型擦除；不引入额外构建步骤。
 */
import {
  runDecodeBench,
  formatBenchReport,
} from '../apps/bedcode/mobile/src/host/__tests__/support/qrDecodeBench.ts'

/** 读取 `--key value` 形式的数值参数 */
function numberArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const options = {
  payloadCount: numberArg('payloads', 20),
  framesPerScan: numberArg('frames', 4),
}

const report = runDecodeBench(options)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(formatBenchReport(report))
  // 扫描级 < 95%（spec §7 DoD 1）时给出非零退出码，便于本地脚本 / 后续 CI 直接判红
  if (report.scanHitRate < 0.95) process.exitCode = 1
}

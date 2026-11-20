/**
 * 浮球位置模型
 *
 * 坐标相对应用容器左上角，单位 px。位置在容器尺寸内夹紧，容器变小或位置值
 * 非法时回落到右下角默认位。
 */

export interface FloatPosition {
  x: number
  y: number
}

export interface FloatContainer {
  width: number
  height: number
}

export interface FloatSize {
  width: number
  height: number
}

export function resolveDefaultFloatPosition(
  container: FloatContainer,
  size: FloatSize,
  margin = 16,
): FloatPosition {
  return {
    x: Math.max(margin, container.width - size.width - margin),
    y: Math.max(margin, container.height - size.height - margin),
  }
}

export function clampFloatPosition(
  position: FloatPosition,
  container: FloatContainer,
  size: FloatSize,
  margin = 12,
): FloatPosition {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return resolveDefaultFloatPosition(container, size, margin)
  }
  const maxX = Math.max(margin, container.width - size.width - margin)
  const maxY = Math.max(margin, container.height - size.height - margin)
  return {
    x: Math.min(Math.max(position.x, margin), maxX),
    y: Math.min(Math.max(position.y, margin), maxY),
  }
}
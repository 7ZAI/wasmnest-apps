/**
 * 界面偏好
 *
 * 由端侧把 `appStorage` 适配成这两个方法的形状；共享组件只依赖该最小接口，
 * 移动端不传时保持整页默认形态。
 */

export type NestViewMode = 'full' | 'panel'

export interface NestFloatPoint {
  x: number
  y: number
}

export interface NestPreferences {
  viewMode: NestViewMode
  /** 小窗是否展开；收起浮球后重开应用仍保持上次开合 */
  panelOpen?: boolean
  float?: NestFloatPoint
  motionEnabled?: boolean
}

export interface NestPrefsAdapter {
  read(): Promise<NestPreferences | null>
  write(value: NestPreferences): Promise<void>
}

export const DEFAULT_NEST_PREFERENCES: NestPreferences = {
  viewMode: 'full',
  motionEnabled: true,
}
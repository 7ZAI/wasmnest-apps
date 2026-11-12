/**
 * 主题 label 解析（issue #24：随宿主提供组件自宿主 utils/themeLabel 迁入）
 *
 * label 为 i18n key（bedcode 域 'theme.followSystem'，键名与终端域
 * `../terminal/config/themes.ts` 的同名逻辑一致）时经 t 解析，否则原样返回
 * （如 'Vitesse Dark' 等品牌名）。
 */
const I18N_PREFIX = 'theme.'

export function resolveThemeLabel(label: string, t: (key: string) => string): string {
  if (label.startsWith(I18N_PREFIX)) {
    return t(label)
  }
  return label
}

/**
 * 设置域文案（票 2026-10-10：全量 UI 下沉 —— 设置域）
 *
 * 键为域内相对键（'settings.*'）。双语同步（zh-CN / en）。
 * 文案真源参考旧宿主 locales/{zh-CN,en}/settings.ts 的既有措辞
 * （`e92cc40a3^` 版本），保持用户跨形态切换时的认知一致。
 */

export const messagesZhCN = {
  settings: {
    title: '设置',
    loading: '正在加载设置…',
    loadFailed: '设置加载失败，已使用默认值',
    saveFailed: '设置保存失败',
    group: {
      connection: '连接',
      notifications: '通知',
      terminal: '终端',
      auth: '认证',
      appearance: '外观',
      platform: '平台设置',
    },
    autoReconnect: '断线自动重连',
    keepAlive: '保持会话连接',
    defaultPort: '默认端口',
    notifyOnWaiting: '会话等待输入时通知',
    notifyOnConnection: '连接建立时通知',
    notifyInBackground: '后台运行时通知',
    vibrate: '振动',
    soundOnTaskComplete: '任务完成提示音',
    maxOpenTerminals: '最大同时打开终端数',
    preferredAuthMethod: '优先认证方式',
    authMethod: {
      pairingCode: '配对码',
      biometric: '生物识别',
    },
    biometric: {
      title: '生物认证绑定',
      hint: '绑定后可用指纹/人脸快速认证本机',
      bound: '已绑定',
      notBound: '未绑定',
      bind: '绑定',
      unbind: '解绑',
      binding: '绑定中…',
      unbinding: '解绑中…',
      bindDone: '生物认证已绑定',
      unbindDone: '生物认证已解绑',
      failed: '操作失败，请重试',
      needPaired: '请先连接并认证桌面端后再绑定',
      unsupported: '本机不支持生物识别',
      noHardware: '本机无生物识别硬件',
      noneEnrolled: '系统未录入指纹或人脸，请先在系统设置中录入',
      unbindConfirm: '解绑后将无法用生物认证登录，需重新绑定。确定解绑吗？',
    },
    accentPalette: '主色色板',
    accentPaletteHint: '仅影响本应用界面，不改变外壳配色',
    palette: {
      default: '默认',
      forest: '森野绿',
      ocean: '海洋青',
      sunset: '落日晚霞',
      violet: '星空紫',
    },
    actions: {
      reset: '重置设置',
      resetConfirm: '确定要把业务设置恢复为默认值吗？',
      resetDone: '已重置为默认值',
    },
  },
}

export const messagesEn = {
  settings: {
    title: 'Settings',
    loading: 'Loading settings…',
    loadFailed: 'Failed to load settings, using defaults',
    saveFailed: 'Failed to save settings',
    group: {
      connection: 'Connection',
      notifications: 'Notifications',
      terminal: 'Terminal',
      auth: 'Authentication',
      appearance: 'Appearance',
      platform: 'Platform settings',
    },
    autoReconnect: 'Reconnect automatically',
    keepAlive: 'Keep sessions alive',
    defaultPort: 'Default port',
    notifyOnWaiting: 'Notify when a session waits for input',
    notifyOnConnection: 'Notify when connected',
    notifyInBackground: 'Notify while running in background',
    vibrate: 'Vibrate',
    soundOnTaskComplete: 'Sound on task completion',
    maxOpenTerminals: 'Max simultaneous terminals',
    preferredAuthMethod: 'Preferred sign-in method',
    authMethod: {
      pairingCode: 'Pairing code',
      biometric: 'Biometrics',
    },
    biometric: {
      title: 'Biometric binding',
      hint: 'Bind to sign in quickly with fingerprint or face',
      bound: 'Bound',
      notBound: 'Not bound',
      bind: 'Bind',
      unbind: 'Unbind',
      binding: 'Binding…',
      unbinding: 'Unbinding…',
      bindDone: 'Biometric credential bound',
      unbindDone: 'Biometric credential unbound',
      failed: 'Operation failed, please retry',
      needPaired: 'Connect and authenticate with the desktop first',
      unsupported: 'This device does not support biometrics',
      noHardware: 'No biometric hardware on this device',
      noneEnrolled: 'No fingerprint or face enrolled. Add one in system settings first',
      unbindConfirm:
        'After unbinding you cannot sign in with biometrics until you bind again. Unbind?',
    },
    accentPalette: 'Accent palette',
    accentPaletteHint: 'Applies to this app only; the shell keeps its own colours',
    palette: {
      default: 'Default',
      forest: 'Forest',
      ocean: 'Ocean',
      sunset: 'Sunset',
      violet: 'Violet',
    },
    actions: {
      reset: 'Reset settings',
      resetConfirm: 'Restore business settings to their default values?',
      resetDone: 'Settings restored to defaults',
    },
  },
}

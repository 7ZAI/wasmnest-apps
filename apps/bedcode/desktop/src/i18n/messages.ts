/**
 * WasmNest 插件 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增/遗漏 key 在编译期即报错，
 * 保证两份语言文件 key 永远同步（spec 票 13「`session.*` 命名空间前缀落定，
 * zh-CN / en 双文件同步」）。
 *
 * key 为各域相对键（session.* / pairing.* / task.* / appearance.* / server.* /
 * sidebar.* / linkCrypto.* / notFound.* / settings.*），注册时经插件 ID 前缀隔离为
 * `com.wasmnest.bedcode.session.*`（`context.i18n.t('session.x')` 自动补前缀）。
 * 用 type 别名而非 interface：TS 给类型别名隐式索引签名，使 MessageSchema
 * 可直接赋给 `Record<string, unknown>`（registerMessages 入参）。
 */

export type MessageSchema = {
  // ==================== 侧边栏 ====================
  'session.sidebar.title': string

  // ==================== 页签与分组 ====================
  'session.tab.configs': string
  'session.tab.running': string
  'session.section.configs': string
  'session.section.running': string

  // ==================== 空态 ====================
  'session.empty.noConfig': string
  'session.empty.noConfigHint': string
  'session.empty.noSessions': string
  'session.empty.noSessionsHint': string

  // ==================== 按钮 ====================
  'session.button.refresh': string
  'session.button.start': string
  'session.button.stop': string
  'session.button.delete': string
  'session.button.cancel': string
  'session.button.save': string
  'session.button.create': string
  'session.button.edit': string
  'session.button.browse': string

  // ==================== 状态文案 ====================
  'session.status.starting': string
  'session.status.running': string
  'session.status.asking': string
  'session.status.error': string
  'session.status.stopped': string
  'session.status.unknown': string

  // ==================== 运行时长 ====================
  'session.time.secondsAgo': string
  'session.time.minutesSecondsAgo': string
  'session.time.hoursMinutesAgo': string

  // ==================== 终端窗口（视图壳票 03a 迁入，本体在插件） ====================
  'session.terminal.view': string
  'session.terminal.restart': string
  'session.terminal.opening': string
  'session.terminal.openFailed': string
  'session.terminal.rendererDesktop': string
  'session.terminal.rendererMobile': string
  // 终端窗口视图（票 03a，manifest/注册元数据 title）
  'session.terminal.windowTitle': string
  // 壳（票 03a 自宿主 desktop.terminal.* 迁入）
  'session.terminal.defaultName': string
  'session.terminal.settings': string
  'session.terminal.theme': string
  'session.terminal.fontSize': string
  'session.terminal.letterSpacing': string
  'session.terminal.clearScreen': string
  'session.terminal.refreshFormat': string
  'session.terminal.minimize': string
  'session.terminal.maximize': string
  'session.terminal.close': string
  'session.terminal.loadingSession': string
  'session.terminal.scrollToBottom': string
  'session.terminal.uptime': string
  'session.terminal.stopped': string
  'session.terminal.stopFailed': string
  'session.terminal.bgImage': string
  'session.terminal.bgImageSelect': string
  'session.terminal.bgImageRemove': string
  'session.terminal.bgImageOpacity': string
  'session.terminal.bgImageSetFailed': string
  'session.terminal.rendererOverrideTitle': string
  'session.terminal.rendererOverrideBody': string
  'session.terminal.rendererOverrideCancel': string
  'session.terminal.rendererOverrideConfirm': string

  // ==================== 操作中遮罩 ====================
  'session.operating.starting': string
  'session.operating.stopping': string
  'session.operating.restarting': string
  'session.operating.stoppingAndDeleting': string
  'session.operating.processing': string

  // ==================== 确认弹窗 ====================
  'session.confirm.stopTitle': string
  'session.confirm.stopMsg': string
  'session.confirm.deleteSessionTitle': string
  'session.confirm.deleteRunningMsg': string
  'session.confirm.stopAndDelete': string
  'session.confirm.deleteConfigTitle': string
  'session.confirm.deleteConfigMsg': string

  // ==================== 结果提示 ====================
  'session.toast.started': string
  'session.toast.stopped': string
  'session.toast.restarted': string
  'session.toast.deleted': string
  'session.toast.configDeleted': string
  'session.toast.configUpdated': string
  'session.toast.configCreated': string
  'session.toast.listRefreshed': string

  // ==================== 错误提示 ====================
  'session.error.loadFailed': string
  'session.error.startFailed': string
  'session.error.stopFailed': string
  'session.error.restartFailed': string
  'session.error.deleteFailed': string
  'session.error.saveFailed': string
  'session.error.notRunning': string
  // 票 02（ADR 0030 决定 6）：业务码文案骨架——code = 注册后完整 key
  // `<plugin_id>.session.error.sessionNotFound`；宿主对插件码只透传不解释，
  // 前端消费层以裸 key 回退查找（业务码与文案 key 零映射层）
  'session.error.sessionNotFound': string

  // ==================== 配置表单 ====================
  'session.form.title.new': string
  'session.form.title.edit': string
  'session.form.name': string
  'session.form.namePlaceholder': string
  'session.form.nameRequired': string
  'session.form.environment': string
  'session.form.wslDistro': string
  'session.form.wslDistroPlaceholder': string
  'session.form.wslInitializing': string
  'session.form.wslNotDetected': string
  'session.form.wslDetectFailed': string
  'session.form.workingDir': string
  'session.form.workingDirRequired': string
  'session.form.command': string
  'session.form.commandRequired': string
  'session.form.commandPlaceholder': string
  'session.form.commandHelp': string
  'session.form.customCommand': string
  'session.form.commandPreset.claude': string
  'session.form.commandPreset.codex': string
  'session.form.commandPreset.pi': string
  'session.form.commandPreset.opencode': string
  'session.form.commandPreset.custom': string
  'session.form.windowsNative': string
  'session.form.linuxNative': string

  // ==================== 设备与配对域（票 14，`pairing.` 命名空间） ====================
  // 文案来源：宿主 `desktop.device.*` / `desktop.sidebar.*` / `settings.pairing.*`
  // 与 `common.*`（逐字复制，保证界面不变），注册时经插件 ID 前缀隔离。

  /** 侧边栏：设备与配对目录项 */
  'pairing.sidebar.title': string
  /** 侧边栏：连接历史目录项 */
  'pairing.history.sidebar.title': string
  /** 设置页贡献分组标题（宿主按 `${pluginId}.${titleKey}` 解析） */
  'pairing.settings.title': string

  // ==================== 网络信息条 ====================
  'pairing.network.title': string
  'pairing.network.ipv4Address': string
  'pairing.network.websocketPort': string
  'pairing.network.noIpv4': string
  'pairing.network.notSelected': string

  // ==================== 页签 ====================
  'pairing.tab.pairing': string
  'pairing.tab.devices': string

  // ==================== 配对码卡 ====================
  'pairing.code.title': string
  'pairing.code.generate': string
  'pairing.code.hint': string
  'pairing.code.placeholder': string
  'pairing.code.request': string
  'pairing.code.generateFailed': string
  'pairing.code.generateFailedNoCode': string

  // ==================== QR 卡 ====================
  'pairing.qr.title': string
  'pairing.qr.generate': string
  'pairing.qr.hint': string
  'pairing.qr.singleUse': string
  'pairing.qr.placeholder': string

  // ==================== 设备列表 ====================
  'pairing.device.sectionOnline': string
  'pairing.device.sectionOffline': string
  'pairing.device.connected': string
  'pairing.device.offline': string
  'pairing.device.pairedAt': string
  'pairing.device.lastSeen': string
  'pairing.device.connectCount': string
  'pairing.device.historyView': string
  'pairing.device.confirmRemove': string
  'pairing.device.confirmRemoveMsg': string
  'pairing.device.removed': string

  // ==================== 入场签发密钥轮换（ADR 0033 D4） ====================
  'pairing.key.sectionTitle': string
  'pairing.key.description': string
  'pairing.key.rotate': string
  'pairing.key.confirmTitle': string
  'pairing.key.confirmMsg': string
  'pairing.key.rotated': string
  'pairing.key.rotatedTo': string
  'pairing.key.error': string

  // ==================== 认证中心就位状态（ADR 0031 欠账 / 票 08 §8.1） ====================
  'pairing.center.notReadyTitle': string
  'pairing.center.notReadyDesc': string
  'pairing.center.rebuildHint': string
  'pairing.center.statusUnknown': string

  // ==================== 连接历史 ====================
  'pairing.history.title': string
  'pairing.history.back': string
  'pairing.history.empty': string
  'pairing.history.clear': string
  'pairing.history.cleared': string
  'pairing.history.clearConfirm': string
  'pairing.history.loadFailed': string
  'pairing.history.statistics': string
  'pairing.history.method.pairingCode': string
  'pairing.history.method.qr': string
  'pairing.history.method.biometric': string
  'pairing.history.method.jwt': string
  'pairing.history.method.unknown': string
  'pairing.history.result.success': string
  'pairing.history.result.failed': string

  // ==================== 设置分组（配对码 / QR 有效期） ====================
  'pairing.settings.qrValidity': string
  'pairing.settings.qrValidityDesc': string
  'pairing.settings.pairingCodeTtl': string
  'pairing.settings.pairingCodeTtlDesc': string
  'pairing.settings.saved': string
  'pairing.settings.saveFailed': string

  // ==================== 通用（宿主 common.* 副本，逐字一致） ====================
  'pairing.button.refresh': string
  'pairing.button.cancel': string
  'pairing.button.remove': string
  'pairing.button.clear': string
  'pairing.time.seconds': string
  'pairing.empty.noData': string
  'pairing.status.unknown': string
  'pairing.status.loading': string

  // ==================== 结果提示与错误 ====================
  'pairing.toast.listRefreshed': string
  'pairing.error.loadFailed': string
  'pairing.error.qrFailed': string
  'pairing.error.revokeFailed': string

  // ==================== 任务域（票 17，`task.` 命名空间） ====================
  // 文案来源：`com.wasmnest.auto-task` 插件扁平 key 全部加 `task.` 前缀后并入
  // （spec D6：插件侧扁平 key 必须先加命名空间前缀，否则同注册表后写覆盖）。

  // ==================== 自动任务弹窗 ====================
  'task.title': string
  'task.idle': string
  'task.inProgress': string
  'task.asking': string
  'task.retrying': string
  'task.completed': string
  'task.interrupted': string
  'task.pending': string
  'task.autoExecute': string
  'task.autoExecuteHint': string
  'task.autoAnswer': string
  'task.autoAnswerHint': string
  'task.inputPlaceholder': string
  'task.add': string
  'task.clearQueue': string
  'task.confirm': string
  'task.datepickerNow': string
  'task.close': string
  'task.loading': string
  'task.emptyQueue': string
  'task.emptyHint': string
  'task.noSession': string
  'task.moveUp': string
  'task.moveDown': string
  'task.edit': string
  'task.save': string
  'task.cancel': string
  'task.delete': string
  'task.clearConfirm': string
  'task.loadFailed': string
  'task.addFailed': string
  'task.removeFailed': string
  'task.cancelTask': string
  'task.cancelTaskFailed': string
  'task.activeTask': string
  'task.clearFailed': string
  'task.updateFailed': string
  'task.reorderFailed': string
  'task.modeFailed': string
  'task.sessionFlagFailed': string
  // ==================== 任务历史视图 ====================
  'task.historyTitle': string
  'task.queueTitle': string
  'task.emptyHistory': string
  'task.emptyHistoryHint': string
  // ==================== Tab 视图 ====================
  'task.tabsCurrent': string
  'task.tabsRecords': string
  'task.tabsScheduled': string
  'task.tabsStats': string
  // ==================== 当前任务 Tab ====================
  'task.currentTaskTitle': string
  'task.executingTaskTitle': string
  'task.queueCount': string
  'task.createTaskTitle': string
  'task.createTaskSession': string
  'task.saveAsPresetOption': string
  'task.createNewSessionOption': string
  'task.createTaskPromptPlaceholder': string
  'task.createTaskSubmit': string
  'task.createTaskFailed': string
  'task.noRunningSessions': string
  'task.noRunningSessionsHint': string
  'task.configQueueTitle': string
  'task.queueStart': string
  'task.queueStartHint': string
  'task.queueStartEmptyHint': string
  'task.queueAutoMode': string
  'task.queueAutoModeHint': string
  'task.queueStartFailed': string
  'task.queueAutoFailed': string
  'task.presetQueueLabel': string
  'task.presetQueueEmpty': string
  'task.presetQueueHint': string
  'task.agentNotAdapted': string
  // ==================== 预设任务 ====================
  'task.presetTitle': string
  'task.saveAsPreset': string
  'task.createTaskPresetHint': string
  'task.addToQueue': string
  'task.presetAddHint': string
  'task.createPresetFailed': string
  'task.addPresetFailed': string
  'task.deletePresetFailed': string
  // ==================== 任务记录筛选 ====================
  'task.filterStatus': string
  'task.filterAgent': string
  'task.filterSource': string
  'task.sourceUser': string
  'task.sourceQueue': string
  'task.sourceScheduled': string
  'task.filterSince': string
  'task.filterUntil': string
  'task.filterReset': string
  // ==================== 统计条 ====================
  'task.statsTitle': string
  'task.statsTotal': string
  'task.statsSuccessRate': string
  'task.statsAvgDuration': string
  'task.statsCompleted': string
  'task.statsTerminal': string
  'task.durationSeconds': string
  'task.durationMinutes': string
  'task.durationHours': string
  // ==================== 分页 ====================
  'task.paginationRange': string
  'task.paginationPrev': string
  'task.paginationNext': string
  // ==================== 行内详情 ====================
  'task.detailAgent': string
  'task.detailSource': string
  'task.detailCreated': string
  'task.detailStarted': string
  'task.detailCompleted': string
  'task.detailWorkingDir': string
  'task.detailExitReason': string
  'task.detailDescription': string
  // ==================== 定时任务 ====================
  'task.scheduledSectionActive': string
  'task.scheduledSectionFinished': string
  'task.scheduledClearFinished': string
  'task.scheduledEmpty': string
  'task.scheduledEmptyHint': string
  'task.scheduledNew': string
  'task.scheduledName': string
  'task.scheduledConfig': string
  'task.scheduledConfigPlaceholder': string
  'task.scheduledTriggerAt': string
  'task.scheduledUtcHint': string
  'task.scheduledPrompts': string
  'task.scheduledPromptPlaceholder': string
  'task.scheduledPromptsHint': string
  'task.scheduledCreate': string
  'task.scheduledCreateFailed': string
  'task.scheduledDeleteFailed': string
  'task.scheduledReset': string
  'task.scheduledResetFailed': string
  'task.scheduledResetHint': string
  'task.scheduledFormInvalid': string
  'task.scheduledStatusCreating': string
  'task.scheduledStatusExecuted': string
  'task.scheduledStatusFailed': string
  'task.scheduledStatusMissed': string
  'task.scheduledError': string

  // ==================== 全局通知（宿主 useGlobalNotifications 承接的设备上下线） ====================
  'session.notification.deviceConnected': string
  'session.notification.deviceDisconnected': string
  'session.notification.mobileDevice': string

  // ==================== 设置页「会话」分组（默认执行环境 / 默认启动命令） ====================
  // 槽位：宿主 `BUILTIN_SECTION_ORDERS.session`（400）退役后由本分组占据原位
  'session.settings.title': string
  'session.settings.defaultEnvironment': string
  'session.settings.defaultCommand': string
  'session.settings.defaultPort': string
  'session.settings.portInvalid': string
  'session.settings.saved': string
  'session.settings.saveFailed': string

  // ==================== 设置页「外观」分组（主题色板归应用，设置归属修正 2026-10-19） ====================
  'appearance.settings.title': string
  'appearance.settings.hint': string
  'appearance.settings.saveFailed': string
  'appearance.palette': string
  'appearance.paletteWarm': string
  'appearance.paletteCool': string
  'appearance.paletteForest': string
  'appearance.paletteOcean': string
  'appearance.paletteSunset': string
  'appearance.paletteViolet': string

  // ==================== 设置页页头（app 自持；旧实现直取未注册的 `settings.title`） ====================
  'settings.title': string

  // ==================== 侧边栏（2026-10-27 自宿主 `desktop.sidebar.*` 迁入） ====================
  'sidebar.settings': string
  'sidebar.navigation': string
  'sidebar.serviceRunning': string
  'sidebar.serviceStopped': string
  'sidebar.serviceStarting': string
  'sidebar.collapse': string
  'sidebar.expand': string

  // ==================== 服务器管理（2026-10-27 自宿主 `desktop.server.*` 迁入） ====================
  'server.title': string
  'server.sectionStatus': string
  'server.sectionNetwork': string
  'server.port': string
  'server.portHint': string
  'server.surfaceHint': string
  'server.portSave': string
  'server.portSavedDelayed': string
  'server.localIp': string
  'server.status.running': string
  'server.status.stopped': string
  'server.status.starting': string
  'server.monitoring': string
  'server.uptime': string
  'server.connections': string
  'server.totalRequests': string
  'server.cpuUsage': string
  'server.memoryUsage': string
  'server.requestRate': string
  'server.wsThroughput': string
  'server.wsSentRate': string
  'server.wsRecvRate': string
  'server.advancedConfig': string
  'server.workers': string
  'server.workersHint': string
  'server.keepAlive': string
  'server.keepAliveHint': string
  'server.clientRequestTimeout': string
  'server.clientDisconnectTimeout': string
  'server.maxConnections': string
  'server.maxConnectionsHint': string
  'server.backlog': string
  'server.tcpNodelay': string
  'server.shutdownTimeout': string
  'server.wsMaxFrameSize': string
  'server.wsMaxFrameSizeHint': string
  'server.wsMaxMessageSize': string
  'server.wsMaxMessageSizeHint': string
  'server.resetDefaults': string
  'server.resetSuccess': string
  'server.collapse': string
  'server.expand': string
  'server.toggleOn': string
  'server.toggleOff': string

  // ==================== 链路加密设置（2026-10-27 自宿主 `settings.linkCrypto.*` 迁入） ====================
  'linkCrypto.title': string
  'linkCrypto.master': string
  'linkCrypto.encryptHttp': string
  'linkCrypto.encryptHttpDesc': string
  'linkCrypto.encryptWsTerminal': string
  'linkCrypto.encryptWsTerminalDesc': string
  'linkCrypto.encryptWsEvent': string
  'linkCrypto.encryptWsEventDesc': string
  'linkCrypto.plaintextFallback': string
  'linkCrypto.plaintextFallbackDesc': string
  'linkCrypto.fingerprint': string
  'linkCrypto.fingerprintDesc': string
  'linkCrypto.saveFailed': string

  // ==================== 应用级兜底（2026-10-27 自宿主 `desktop.notFound.*` / `desktop.runtimeUnexpected` 迁入） ====================
  'notFound.title': string
  'notFound.body': string
  'notFound.back': string
  runtimeUnexpected: string

  // ==================== 终端窗口标题（2026-10-27 自宿主 `common.misc.terminalTitle` 迁入） ====================
  'session.terminal.windowTitleWithName': string

  // ==================== 多任务卡片只读预览面（mountPreview · 2026-10-20） ====================
  'session.preview.eyebrow': string
  'session.preview.runningCount': string
  'session.preview.workspace': string
  'session.preview.empty': string
  'session.preview.emptyHint': string
  'session.preview.unavailable': string
  'session.preview.lastRoute': string
  'session.preview.status.idle': string
  'session.preview.status.stopping': string
  // ==================== Agent 管理域（原 agent-hub 并入，键保持 hub.* 前缀） ====================
  // ==================== 侧边栏 ====================
  'hub.sidebar.title': string

  // ==================== 顶部 tabs（变体 B） ====================
  'hub.tab.overview': string
  'hub.tab.install': string
  'hub.tab.skills': string
  'hub.tab.providers': string
  'hub.tab.stats': string
  'hub.tab.logs': string

  // ==================== 分区占位（票据 03–07 交付） ====================

  // ==================== 概览 · 环境条 ====================
  'hub.env.title': string
  'hub.env.os': string
  'hub.env.node': string
  'hub.env.npm': string
  'hub.env.pnpm': string
  'hub.env.registry': string
  'hub.env.python': string
  'hub.env.arch': string
  'hub.env.osVersion': string
  'hub.env.shell': string
  'hub.env.detect': string
  'hub.env.detecting': string
  'hub.env.none': string
  // 环境采集成功但没装 node（确认没装，不是探测失败）
  'hub.env.nodeMissing': string
  // 环境采集没结论（进程失败/超时/输出不可解析）
  'hub.env.detectFailed': string
  // 环境采集成功但没装 node：给「安装 Node.js（含 npm）」入口（P3）
  'hub.env.node.missing': string
  'hub.env.node.install': string

  // ==================== 概览 · CLI 卡片 ====================
  'hub.card.installed': string
  // 已装但未初始化（票 07：CLI 装了却零会话数据，如本机 codex）
  'hub.card.installedNoSessions': string
  'hub.card.notInstalled': string
  'hub.card.error': string
  // 探测没结论（unavailable）：与「未安装」严格区分
  'hub.card.unavailable': string
  'hub.card.retry': string
  'hub.card.detecting': string
  'hub.card.dual': string
  'hub.card.dualWarning': string
  'hub.card.versionUnknown': string
  'hub.card.idle': string
  'hub.card.method.npm-global': string
  'hub.card.method.native': string
  'hub.card.method.standalone': string
  'hub.card.method.unknown': string
  // ==================== 概览 · CLI 卸载（概览卡片动作） ====================
  'hub.card.uninstall': string
  'hub.card.uninstallConfirm': string
  'hub.card.uninstallRunning': string
  'hub.card.uninstallHintDual': string
  'hub.card.uninstallHintMethod': string
  'hub.card.uninstallHintNode': string
  'hub.card.uninstallFailed': string
  'hub.card.uninstallRunFailed': string

  // ==================== 目录授权 ====================
  'hub.auth.banner': string
  'hub.agents.degraded': string
  'hub.auth.action': string

  // ==================== 安装与更新 · 测速/镜像（票据 03） ====================
  'hub.speed.title': string
  'hub.speed.action': string
  'hub.speed.testing': string
  'hub.speed.official': string
  'hub.speed.mirror': string
  'hub.speed.recommendMirror': string
  'hub.speed.recommendOfficial': string
  'hub.speed.current': string
  'hub.speed.fail': string
  'hub.speed.goto': string
  'hub.speed.recommended': string
  'hub.speed.currentTag': string
  'hub.speed.select': string
  'hub.speed.addCustom': string
  'hub.speed.addCustomPlaceholder': string
  'hub.speed.removeCustom': string
  'hub.speed.source.npmmirror': string
  'hub.speed.source.npmjs': string
  'hub.speed.source.huawei': string
  'hub.speed.source.tencent': string
  'hub.speed.source.yarn': string
  'hub.speed.source.custom': string
  'hub.mirror.persist': string
  'hub.mirror.persistConfirm': string
  'hub.mirror.restore': string
  'hub.mirror.tmp': string

  // ==================== 安装与更新 · CLI 行/控制台（票据 03） ====================
  'hub.inst.title': string
  'hub.inst.check': string
  'hub.inst.checking': string
  'hub.inst.install': string
  'hub.inst.update': string
  'hub.inst.latest': string
  'hub.inst.running': string
  'hub.inst.nodeGuide': string
  'hub.inst.copy': string
  'hub.inst.copied': string
  'hub.inst.done': string
  'hub.inst.failed': string
  // ADR 0030 业务错误码（guest bail_with_code!/user_facing_string，完整 key =
  // com.wasmnest.agent-hub.hub.inst.error.*）：用户可见拒绝的原因文案
  'hub.inst.error.busy': string
  'hub.inst.error.detectionPending': string
  'hub.inst.error.nodeMissing': string
  // 探测没结论（unavailable）：先重试检测，不是「不支持这种安装方式」
  'hub.inst.error.probeUnavailable': string
  'hub.inst.cancelled': string
  'hub.inst.cancel': string
  'hub.inst.outputEmpty': string
  'hub.inst.console': string

  // ==================== Node.js 环境引导（P3） ====================
  'hub.boot.confirm.title': string
  // 一句话说明「装什么、从哪来、多大」（参数：version / platform / host / size）
  'hub.boot.confirm.body': string
  // 安全告知：会把目录写进用户级 PATH（不是机器级、不写 shell rc）
  'hub.boot.confirm.path': string
  'hub.boot.row.version': string
  'hub.boot.row.platform': string
  'hub.boot.row.source': string
  'hub.boot.row.size': string
  'hub.boot.row.sha256': string
  'hub.boot.sha.show': string
  'hub.boot.sha.hide': string
  'hub.boot.start': string
  'hub.boot.close': string
  'hub.boot.cancel': string
  'hub.boot.retry': string
  'hub.boot.detail': string
  'hub.boot.detailHide': string
  // 已用时（参数：s = 秒）
  'hub.boot.elapsed': string
  'hub.boot.done': string
  // 已有可用 node：不下载、不改 PATH
  'hub.boot.already': string
  // 链式安装（参数：cli = 目标 CLI 展示名）：装完 node 自动继续装它
  'hub.boot.chain': string
  'hub.boot.phase.preflight': string
  'hub.boot.phase.downloading': string
  'hub.boot.phase.verifying': string
  'hub.boot.phase.extracting': string
  'hub.boot.phase.registering': string
  'hub.boot.phase.reprobing': string
  // 失败文案（guest `Code::as_str` → 短名映射）
  'hub.boot.failed.generic': string
  'hub.boot.failed.unsupportedPlatform': string
  'hub.boot.failed.insufficientSpace': string
  'hub.boot.failed.downloadFailed': string
  'hub.boot.failed.verifyFailed': string
  'hub.boot.failed.extractFailed': string
  'hub.boot.failed.registerPathFailed': string
  'hub.boot.failed.reprobeFailed': string
  'hub.boot.failed.cancelled': string
  // ADR 0030 业务码（guest bail_with_code!）：引导被拒（如有安装任务在跑）
  'hub.boot.error.busy': string

  // ==================== Node.js 运行时管理（P4：升级 / 移除） ====================
  // 本插件已装的版本（参数：version）
  'hub.env.node.managed': string
  // 有新钉住版本可升级（参数：version）
  'hub.env.node.upgrade': string
  'hub.env.node.remove': string
  // 旧版本目录删不掉（参数：paths）；只能提示重启后再清理
  'hub.env.node.cleanupPending': string
  'hub.remove.title': string
  'hub.remove.body': string
  // 后果告知（P4 硬要求）：已装 CLI 会暂时无法运行
  'hub.remove.warning': string
  'hub.remove.confirm': string
  'hub.remove.working': string
  'hub.remove.failed': string

  // ==================== Skills 管理（票据 04） ====================
  'hub.skill.scan': string
  'hub.skill.scanning': string
  'hub.skill.library': string
  'hub.skill.targetSync': string
  'hub.skill.targetStale': string
  'hub.skill.targetIdle': string
  'hub.skill.targetNoConvention': string
  'hub.skill.scanError': string
  'hub.skill.empty': string
  'hub.skill.emptyHint': string
  'hub.skill.edit': string
  'hub.skill.distribute': string
  'hub.skill.redistribute': string
  'hub.skill.distributing': string
  'hub.skill.status.libraryOnly': string
  'hub.skill.status.synced': string
  'hub.skill.status.stale': string

  // ==================== Skills · GitHub 安装（票据 04） ====================
  'hub.skill.github.action': string
  'hub.skill.github.title': string
  'hub.skill.github.urlPlaceholder': string
  'hub.skill.github.hint': string
  'hub.skill.github.install': string
  'hub.skill.github.installing': string
  'hub.skill.github.done': string
  'hub.skill.github.skipped': string
  'hub.skill.github.exists': string
  'hub.skill.github.overwrite': string
  'hub.skill.github.unreachable': string
  'hub.skill.github.failed': string

  // ==================== Skills · 本地导入（票据 04） ====================
  'hub.skill.import.action': string
  'hub.skill.import.exists': string
  'hub.skill.import.overwrite': string
  'hub.skill.import.authDenied': string
  'hub.skill.import.done': string
  'hub.skill.import.failed': string

  // ==================== Skills · 编辑器（票据 04） ====================
  'hub.skill.editor.title': string
  'hub.skill.editor.back': string
  'hub.skill.editor.save': string
  'hub.skill.editor.clean': string
  'hub.skill.editor.saved': string
  'hub.skill.editor.previewTitle': string
  'hub.skill.editor.confirmSave': string
  'hub.skill.editor.continueEdit': string
  'hub.skill.editor.conflict': string
  'hub.skill.editor.overwriteMine': string
  'hub.skill.editor.reload': string

  // ==================== 供应商管理（票据 05） ====================
  'hub.pv.secure': string
  'hub.pv.new': string
  'hub.pv.import': string
  'hub.pv.importing': string
  'hub.pv.importDone': string
  'hub.pv.importSkipped': string
  'hub.pv.importNone': string
  'hub.pv.importFailed': string
  'hub.pv.deleteFailed': string
  'hub.pv.toast.created': string
  'hub.pv.toast.updated': string
  'hub.pv.toast.deleted': string
  'hub.pv.toast.applied': string
  'hub.pv.keyMask': string
  'hub.pv.empty': string
  'hub.pv.emptyHint': string
  'hub.pv.source.imported': string
  'hub.pv.source.manual': string
  'hub.pv.style.openai': string
  'hub.pv.style.anthropic': string
  'hub.pv.style.gemini': string
  'hub.pv.style.custom': string
  'hub.pv.models': string
  'hub.pv.modelsMissing': string
  'hub.pv.apply': string
  'hub.pv.edit': string
  'hub.pv.delete': string
  'hub.pv.deleteConfirm': string

  // ==================== 供应商 · claude 只读视图（票据 05） ====================
  'hub.pv.claude.title': string
  'hub.pv.claude.none': string
  'hub.pv.claude.bridge': string
  'hub.pv.claude.baseUrl': string
  'hub.pv.claude.model': string
  'hub.pv.claude.token': string

  // ==================== 供应商 · 编辑器（票据 05） ====================
  'hub.pv.editor.titleNew': string
  'hub.pv.editor.titleEdit': string
  'hub.pv.editor.close': string
  'hub.pv.editor.required': string
  'hub.pv.editor.template': string
  'hub.pv.editor.templateOverwrite': string
  'hub.pv.editor.templateOverwriteConfirm': string
  'hub.pv.editor.name': string
  'hub.pv.editor.baseUrl': string
  'hub.pv.editor.apiStyle': string
  'hub.pv.editor.models': string
  'hub.pv.editor.modelsUrl': string
  'hub.pv.editor.modelsUrlHint': string
  'hub.pv.editor.modelsUrlDerive': string
  'hub.pv.editor.modelsFetch': string
  'hub.pv.editor.modelsFetching': string
  'hub.pv.editor.modelsFetchFailed': string
  'hub.pv.editor.modelsAddAll': string
  'hub.pv.editor.modelsEmpty': string
  'hub.pv.editor.nameExists': string
  'hub.pv.editor.saveFailed': string
  'hub.pv.editor.save': string
  'hub.pv.editor.cancel': string
  'hub.pv.editor.key': string
  'hub.pv.editor.keyNew': string
  'hub.pv.editor.keyPlaceholder': string
  'hub.pv.editor.keyHint': string
  'hub.pv.editor.keyClear': string
  'hub.pv.editor.keyKeep': string

  // ==================== 供应商 · 应用（票据 05） ====================
  'hub.pv.apply.title': string
  'hub.pv.apply.back': string
  'hub.pv.apply.note': string
  'hub.pv.apply.noteNone': string
  'hub.pv.apply.target': string
  'hub.pv.apply.targetHint': string
  'hub.pv.apply.targetName': string
  'hub.pv.apply.targetNameHint': string
  'hub.pv.apply.codexUnsupported': string
  'hub.pv.apply.keyMode': string
  'hub.pv.apply.keyStored': string
  'hub.pv.apply.keyStoredHint': string
  'hub.pv.apply.keyInline': string
  'hub.pv.apply.keySource': string
  'hub.pv.apply.keySourceMask': string
  'hub.pv.apply.keyNone': string
  'hub.pv.apply.write': string
  'hub.pv.apply.writing': string
  'hub.pv.apply.restartHint': string
  'hub.pv.apply.conflict': string
  'hub.pv.apply.conflictConfirm': string
  'hub.pv.apply.noModels': string
  'hub.pv.apply.noModelsHint': string
  'hub.pv.apply.reason.bridge': string
  'hub.pv.apply.reason.writeFailed': string
  'hub.pv.apply.reason.dialect': string
  'hub.pv.apply.reason.envKey': string
  'hub.pv.apply.codex.envKey': string
  'hub.pv.apply.codex.envKeyHint': string
  'hub.pv.apply.codex.switchHint': string
  'hub.pv.apply.codex.dialectBlocked': string
  'hub.pv.apply.partial': string
  'hub.pv.apply.failed': string
  // ==================== 使用统计看板（票据 06 + 改版） ====================
  'hub.st.syncedTag': string
  'hub.st.syncing': string
  'hub.st.scanning': string
  'hub.st.scanNow': string
  // ---------- 时间窗 ----------
  'hub.st.range': string
  'hub.st.range.0': string
  'hub.st.range.7': string
  'hub.st.range.30': string
  'hub.st.range.90': string
  // ---------- KPI 卡 ----------
  'hub.st.kpi.sessions': string
  'hub.st.kpi.sessionsSub': string
  'hub.st.kpi.tokens': string
  'hub.st.kpi.tokensSub': string
  'hub.st.kpi.cache': string
  'hub.st.kpi.cacheSub': string
  'hub.st.kpi.duration': string
  'hub.st.kpi.durationSub': string
  'hub.st.kpi.cost': string
  'hub.st.kpi.costSub': string
  'hub.st.kpi.costNone': string
  'hub.st.kpi.coverage': string
  'hub.st.kpi.coverageVal': string
  'hub.st.kpi.coverageSub': string
  'hub.st.kpi.range': string
  'hub.st.kpi.noRange': string
  // ---------- 指标（趋势 / 排行 / 占比共用） ----------
  'hub.st.metricLabel': string
  'hub.st.metric.tokens': string
  'hub.st.metric.tokens_in': string
  'hub.st.metric.tokens_out': string
  'hub.st.metric.tokens_cache_read': string
  'hub.st.metric.tokens_cache_write': string
  'hub.st.metric.tokens_reasoning': string
  'hub.st.metric.sessions': string
  'hub.st.metric.cost_total': string
  'hub.st.metric.duration_ms': string
  // ---------- 趋势图 ----------
  'hub.st.trend.title': string
  'hub.st.trend.mode.total': string
  'hub.st.trend.mode.stack': string
  'hub.st.trend.table': string
  'hub.st.trend.chart': string
  'hub.st.trend.empty': string
  'hub.st.trend.col.day': string
  // ---------- 节奏热力图（7×24） ----------
  'hub.st.heat.title': string
  'hub.st.heat.sub': string
  'hub.st.heat.empty': string
  'hub.st.heat.aria': string
  'hub.st.heat.peak': string
  'hub.st.heat.peakShort': string
  'hub.st.heat.noPeak': string
  'hub.st.heat.rowTotal': string
  'hub.st.heat.legendLow': string
  'hub.st.heat.dow.0': string
  'hub.st.heat.dow.1': string
  'hub.st.heat.dow.2': string
  'hub.st.heat.dow.3': string
  'hub.st.heat.dow.4': string
  'hub.st.heat.dow.5': string
  'hub.st.heat.dow.6': string
  // ---------- CLI 占比环 ----------
  'hub.st.donut.title': string
  'hub.st.donut.sub': string
  'hub.st.donut.empty': string
  // ---------- 排行 ----------
  'hub.st.bars.projects': string
  'hub.st.bars.models': string
  'hub.st.bars.empty': string
  'hub.st.bars.more': string
  'hub.st.modelMessages': string
  'hub.st.noProject': string
  'hub.st.empty': string
  'hub.st.emptyWindow': string
  // 数据清空（票 07：全量保留 + 手动清空）
  'hub.st.clearData': string
  'hub.st.clearDataAsk': string
  'hub.st.clearDataConfirm': string
  'hub.st.clearDataCancel': string
  'hub.st.clearDataDone': string
  'hub.st.clearDataFailed': string
  // 适配器降级（票 07：opencode SQLite 源的机器可读 code → 界面文案）
  'hub.st.degraded': string
  'hub.st.degraded.sqlite3-missing': string
  'hub.st.degraded.db-missing': string
  'hub.st.degraded.query-failed': string

  // ==================== 会话日志（改版：来源 / 查询 / 分页 / 详情） ====================
  'hub.lg.sources.title': string
  'hub.lg.sources.builtin': string
  'hub.lg.sources.custom': string
  'hub.lg.sources.scan': string
  'hub.lg.sources.add': string
  'hub.lg.sources.addDir': string
  'hub.lg.sources.builtinPath': string
  'hub.lg.sources.addName': string
  'hub.lg.sources.nameCustom': string
  'hub.lg.sources.namePick': string
  'hub.lg.sources.pathDuplicate': string
  'hub.lg.sources.addPath': string
  'hub.lg.sources.pick': string
  'hub.lg.sources.picking': string
  'hub.lg.sources.pickFailed': string
  'hub.lg.sources.confirm': string
  'hub.lg.sources.cancel': string
  'hub.lg.sources.removeSource': string
  'hub.lg.sources.removePath': string
  'hub.lg.sources.noScan': string
  'hub.lg.sources.sessions': string
  'hub.lg.sources.files': string
  'hub.lg.sources.kind.jsonl': string
  'hub.lg.sources.kind.sqlite': string
  'hub.lg.sources.addFailed': string
  // ADR 0030 业务错误码（guest bail_with_code!，完整 key =
  // com.wasmnest.agent-hub.hub.lg.sources.error.*）：来源/目录增删被拒的原因文案
  'hub.lg.sources.error.nameTaken': string
  'hub.lg.sources.error.pathTaken': string
  'hub.lg.sources.error.sqliteReadonly': string
  'hub.lg.sources.error.builtinProtected': string
  'hub.lg.sources.error.lastPathProtected': string
  'hub.lg.sources.removeFailed': string
  'hub.lg.sources.addPathFailed': string
  'hub.lg.sources.removePathFailed': string
  'hub.lg.sources.scanTimeout': string
  'hub.lg.sources.scanUnreadable': string
  'hub.lg.sources.scanInterrupted': string
  'hub.lg.sources.scanFailed': string
  'hub.lg.filter.agent': string
  'hub.lg.filter.all': string
  'hub.lg.filter.keyword': string
  'hub.lg.filter.keywordPh': string
  'hub.lg.filter.from': string
  'hub.lg.filter.to': string
  'hub.lg.filter.fromPh': string
  'hub.lg.filter.toPh': string
  'hub.lg.filter.dpSelect': string
  'hub.lg.filter.dpCancel': string
  'hub.lg.filter.dpNow': string
  'hub.lg.filter.query': string
  'hub.lg.filter.reset': string
  'hub.lg.col.agent': string
  'hub.lg.col.session': string
  'hub.lg.col.project': string
  'hub.lg.col.started': string
  'hub.lg.col.duration': string
  'hub.lg.col.tokens': string
  'hub.lg.row.open': string
  /** 正在使用的项目会话徽标（扫描时按配置/最新会话标记） */
  'hub.lg.row.current': string
  /** 当前行 title 提示 */
  'hub.lg.row.currentTip': string
  'hub.lg.noMatch': string
  'hub.lg.pager.total': string
  'hub.lg.pager.page': string
  'hub.lg.pager.prev': string
  'hub.lg.pager.next': string
  'hub.lg.detail.back': string
  'hub.lg.detail.tabChat': string
  'hub.lg.detail.tabRaw': string
  'hub.lg.detail.expand': string
  'hub.lg.detail.collapse': string
  /** 工具卡身展开（与「展开全文」区分：展开的是参数 / 输出） */
  'hub.lg.detail.expandDetail': string
  /** guest 上限截断提示（票 B4 的可做部分） */
  'hub.lg.detail.truncated': string
  'hub.lg.detail.viewRaw': string
  /** 任务记录快捷跳转：回到顶部 / 滑到最底 */
  'hub.lg.detail.toTop': string
  'hub.lg.detail.toBottom': string
  /** guest 非文本块占位 token 的本地化（带块类型；类型名由 guest 给，不翻译） */
  'hub.lg.nonTextBlock': string
  /** 同上，但块类型缺失 / 形态不符 guest 校验 */
  'hub.lg.nonTextBlockUnknown': string
  'hub.lg.noSource': string
  'hub.lg.eventsTruncated': string
  'hub.lg.rawTruncated': string
  'hub.lg.noEvents': string
  /** 「原始 JSONL」页签空态（SQLite 来源恒空，不是加载失败） */
  'hub.lg.noRaw': string
  'hub.lg.role.user': string
  'hub.lg.role.assistant': string
  /** pi 思考事件（assistant content 的 thinking 块；默认折叠 + 弱化样式） */
  'hub.lg.role.thinking': string
  'hub.lg.role.tool': string
  'hub.lg.role.system': string

  // ==================== 多任务卡片只读预览面（mountPreview） ====================
  'hub.preview.subtitle': string
  'hub.preview.loading': string
  'hub.preview.empty': string
  'hub.preview.emptyHint': string
  'hub.preview.installedCount': string
  'hub.preview.sessionCount': string
  'hub.preview.sessionUnknown': string
  'hub.preview.notInstalled': string
  'hub.preview.detecting': string
  'hub.preview.error': string
  'hub.preview.idle': string
  'hub.preview.lastRoute': string
  'hub.launch.open': string
  'hub.launch.title': string
  'hub.launch.env': string
  'hub.launch.env.linux': string
  'hub.launch.env.wsl2': string
  'hub.launch.env.windows': string
  'hub.launch.workingDir': string
  'hub.launch.workingDirPh': string
  'hub.launch.command': string
  'hub.launch.browse': string
  'hub.launch.required': string
  'hub.launch.failed': string
  'hub.launch.confirm': string
  'hub.launch.starting': string
  'hub.launch.cancel': string
  'hub.inst.error.sessionRunning': string

  'hub.pv.importHub': string
  'hub.pv.importHubing': string
  'hub.pv.importHubDone': string
  'hub.pv.importHubFailed': string
  'hub.pv.importAuthDenied': string

  // ==================== 项目与运行（ADR 0003 / issue #23 M2） ====================
  'project.sidebar.title': string

  // 项目管理动作
  'project.button.refresh': string
  'project.button.new': string
  'project.button.create': string
  'project.button.cancel': string
  'project.button.save': string
  'project.button.rename': string
  'project.button.remove': string
  'project.button.browse': string
  'project.button.open': string

  // 空态
  'project.empty.noProjects': string
  'project.empty.noProjectsHint': string

  // 新建 / 改名表单
  'project.form.title.new': string
  'project.form.title.rename': string
  'project.form.name': string
  'project.form.namePlaceholder': string
  'project.form.environment': string
  'project.form.wslDistro': string
  'project.form.wslDistroPlaceholder': string
  'project.form.workingDir': string
  'project.form.workingDirPlaceholder': string
  'project.form.required': string
  'project.form.pickFailed': string
  // 执行环境选项（按宿主平台过滤；与会话表单同一套展示口径）
  'project.form.env.windows': string
  'project.form.env.wsl2': string
  'project.form.env.linux': string
  'project.form.wslInitializing': string
  'project.form.wslNotDetected': string

  // 项目卡
  'project.card.activeRuns': string
  'project.card.runCount': string
  'project.card.lastActivity': string
  'project.card.noActivity': string
  'project.card.lastAgent': string

  // 确认与提示
  'project.confirm.removeTitle': string
  'project.confirm.removeMsg': string
  'project.toast.created': string
  'project.toast.existed': string
  'project.toast.renamed': string
  'project.toast.removed': string
  'project.toast.refreshed': string
  'project.error.loadFailed': string
  'project.error.createFailed': string
  'project.error.renameFailed': string
  'project.error.removeFailed': string
  'project.error.notFound': string

  // 相对时间
  'project.time.justNow': string
  'project.time.minutesAgo': string
  'project.time.hoursAgo': string
  'project.time.daysAgo': string

  // 工作台
  'project.workbench.back': string
  'project.workbench.activeRuns': string

  // 分栏拖拽（三栏宽度调整）
  'project.split.resizeRuns': string
  'project.split.resizeInspector': string
  'project.split.resizeHint': string

  // 运行
  'project.run.title': string
  'project.run.new': string
  'project.run.empty': string
  'project.run.emptyHint': string
  'project.run.pickAgent': string
  'project.run.starting': string
  'project.run.startFailed': string
  'project.run.stop': string
  'project.run.stopFailed': string
  'project.run.openWindow': string
  'project.run.agentMissing': string
  'project.run.agentUnknown': string
  'project.run.installHint': string

  // 对话面（M3：run.events 账本 + run.send 发送）
  'project.chat.title': string
  'project.chat.agentSessionId': string
  'project.chat.copyId': string
  'project.chat.copied': string
  'project.chat.emptyTitle': string
  'project.chat.emptyHint': string
  'project.chat.emptyNoRun': string
  'project.chat.emptyNoRunHint': string
  'project.chat.inputPlaceholder': string
  'project.chat.send': string
  'project.chat.sending': string
  'project.chat.sendFailed': string
  'project.chat.stop': string
  'project.chat.queued': string
  'project.chat.generating': string
  'project.chat.thinking': string
  'project.chat.thinkingRedacted': string
  'project.chat.toolState.pending': string
  'project.chat.toolState.running': string
  'project.chat.toolState.done': string
  'project.chat.toolState.error': string
  'project.chat.expandOutput': string
  'project.chat.collapse': string
  'project.chat.patchTitle': string
  'project.chat.patchFiles': string
  'project.chat.showDiff': string
  'project.chat.hideDiff': string
  'project.chat.planTitle': string
  'project.chat.permissionTitle': string
  'project.chat.permissionNeedTerminal': string
  'project.chat.permissionDecidedBy': string
  'project.chat.agentState.busy': string
  'project.chat.agentState.retrying': string
  'project.chat.agentState.error': string
  'project.chat.mirrorMode': string
  'project.chat.mirrorHint': string
  'project.chat.mirrorPiTrust': string
  'project.chat.truncated': string
  'project.chat.loadFailed': string
  'project.chat.retry': string
  'project.chat.expandPayload': string

  // 检查器
  'project.inspector.changes': string
  'project.inspector.terminal': string
  'project.inspector.events': string
  'project.inspector.noSelection': string
  'project.inspector.changesEmpty': string
  'project.inspector.eventsEmpty': string
}

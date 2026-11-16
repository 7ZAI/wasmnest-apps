import type { MessageSchema } from './messages'

/**
 * 中文（默认）翻译
 *
 * 独立文件维护，构建期由 Vite 打包内联进 bundle，无运行时文件读取。
 */
const zhCN: MessageSchema = {
  // ==================== 侧边栏 ====================
  'transfer.sidebar.title': '文件传输',

  // ==================== 对端 pill ====================
  'transfer.peer.online': '已连接',
  'transfer.peer.offline': '未连接',
  'transfer.peer.notSharing': '已连接 · 对端未共享',
  'transfer.peer.unpaired': '未连接设备',
  'transfer.peer.noSharedRoots': '对方尚未设置共享目录',
  'transfer.peer.unknown': '未知设备',
  'transfer.peer.switchTitle': '附近设备（主动发起连接）',

  // ==================== 附近设备面板 ====================
  'transfer.devices.title': '附近设备',
  'transfer.devices.subtitle': '同一网络内的 WasmNest 节点',
  'transfer.devices.relayEmptyHint':
    '同一中继上的设备会自动出现（需双端配置同一中继，且中继支持自动发现）。',
  'transfer.devices.empty': '未发现附近设备；请确认对方已打开 WasmNest 并接入同一网络',
  'transfer.devices.online': '在线',
  'transfer.devices.recentSeen': '最近可见',
  'transfer.devices.connected': '已连接',
  'transfer.devices.connecting': '连接中…',
  'transfer.devices.connectingHint': '连接中…（对方可能需要在弹窗中确认）',
  'transfer.devices.sendFile': '发送文件',
  'transfer.devices.capNone': '不支持传输',
  'transfer.devices.activeCurrent': '当前设备',
  'transfer.devices.setActive': '设为当前',
  'transfer.devices.disconnect': '断开',
  'transfer.devices.denied': '对方拒绝了连接',
  'transfer.devices.unreachable': '无法连接，设备可能已离线',
  'transfer.devices.trustHint': '首次连接需对方确认；信任管理见 设置 → 可信对端',
  'transfer.devices.discover': '重新发现',
  'transfer.devices.discovering': '发现中…',
  'transfer.devices.discoverHint': '同时重查内网广播与外网穿透发现',
  'transfer.devices.connectLan': '内网',
  'transfer.devices.connectLanHint': '只走内网地址；失败不会自动改走外网',
  'transfer.devices.connectWan': '外网',
  'transfer.devices.connectWanHint': '直接经中继连接（仅在你显式点击时）',
  'transfer.devices.modeBoth': '内网+外网',
  'transfer.devices.modeLanOnly': '仅内网',
  'transfer.devices.modeWanOnly': '仅外网',
  'transfer.devices.modeNone': '暂无通路',
  'transfer.devices.modeNoneHint': '暂无可用地址，请重新发现或移除该设备后重试',
  // T12: 中继 / 远程设备（传输形态、手动尝试外网）
  'transfer.devices.remote': '远程',
  'transfer.devices.removeRemote': '移除',
  'transfer.devices.transportLan': '内网直连',
  'transfer.devices.transportWan': '外网中继',
  // T20：上次传输形态 / 跨网能力 / 分类失败出路
  'transfer.devices.lastTransportLan': '上次：内网直连',
  'transfer.devices.lastTransportWan': '上次：外网中继',
  'transfer.devices.relayTag': '中继发现',
  'transfer.devices.errorNoEndpoint': '设备没有可用地址，请重新发现或移除该设备后重试',
  'transfer.devices.errorRelayDisabled': '中继已关闭：在设置中打开「中继（外网）」后重试',
  'transfer.devices.errorRelayUnreachable': '中继路径不可达：检查中继服务与对端是否在线',
  'transfer.devices.errorTimeout': '连接超时，请重试',
  'transfer.devices.errorUnknown': '连接失败：{detail}',

  // ==================== 顶栏 ====================
  'transfer.topbar.sendToPhone': '发送到当前设备…',
  'transfer.topbar.downloadSelected': '下载所选 ({count})',
  'transfer.topbar.refresh': '刷新',
  'transfer.topbar.settings': '设置',
  'transfer.topbar.closeSettings': '返回',

  // ==================== 我的设备（设置页：设备名 / 指纹） ====================
  'transfer.myDevice.title': '我的设备',
  'transfer.myDevice.loading': '正在读取设备信息…',
  'transfer.myDevice.loadFailed': '读取设备信息失败，请重试',
  'transfer.myDevice.refresh': '重试',
  'transfer.myDevice.unsupportedTitle': '宿主暂不支持',
  'transfer.myDevice.unsupportedBody': '当前宿主未提供设备身份；升级宿主后重试。',
  'transfer.myDevice.deviceName': '设备名',
  'transfer.myDevice.unnamed': '未命名设备',
  'transfer.myDevice.fingerprint': '设备指纹',
  'transfer.myDevice.hint': '对方设备在附近设备列表里用名称与指纹核对本机身份。',

  // ==================== 目录表格 ====================
  'transfer.table.name': '名称',
  'transfer.table.size': '大小',
  'transfer.table.modified': '修改时间',
  'transfer.table.empty': '此目录为空',
  'transfer.table.loading': '加载中...',
  'transfer.breadcrumb.home': '文件',

  // ==================== 任务状态 ====================
  'transfer.task.state.queued': '排队',
  'transfer.task.state.awaitingPeer': '等待对方确认',
  'transfer.task.awaitingPeerHint': '正在等待对方确认，对方接受后将自动开始传输',
  'transfer.task.state.transferring': '传输中',
  'transfer.task.state.paused': '已暂停',
  'transfer.task.state.resumable': '可恢复',
  'transfer.task.state.completed': '已完成',
  'transfer.task.state.failed': '失败',
  'transfer.task.state.rejected': '同名被拒',
  'transfer.task.state.cancelled': '已取消',
  'transfer.task.state.interrupted': '已中断（应用重启）',
  'transfer.task.pause': '暂停',
  'transfer.task.resume': '恢复',
  'transfer.task.cancel': '取消',
  'transfer.task.cancelledToast': '任务已取消',
  'transfer.task.remove': '删除任务',
  'transfer.task.openDir': '打开本地目录',
  'transfer.task.retry': '重新排队',
  'transfer.task.resumeAll': '全部继续',
  'transfer.task.download': '下载',
  'transfer.task.upload': '上传',
  'transfer.task.empty': '暂无任务',
  'transfer.task.receivingEmpty': '暂无接收任务',
  'transfer.task.waitingApproval': '等待对方同意',
  'transfer.task.receiving': '正在接收',
  // ==================== intent 驱动（v2.1） ====================
  'transfer.task.waitingReply': '等待对方确认',
  'transfer.task.peerOffline': '对端离线，任务挂起',

  // ==================== 队列面板 ====================
  'transfer.queue.title': '传输队列',
  'transfer.queue.count': '{count} 项任务',
  'transfer.queue.close': '收起传输队列',

  // ==================== 队列分类 tabs（v2） ====================
  'transfer.queue.all': '全部',
  'transfer.queue.sending': '正在发送',
  'transfer.queue.receiving': '正在接收',
  'transfer.queue.history': '历史',

  // ==================== 批量请求应答（v2） ====================
  'transfer.request.title': '文件传输请求',
  'transfer.request.body': '{name} 想向你发送 {count} 个文件（共 {size}）',
  'transfer.request.countdown': '将在 {seconds} 秒后自动拒绝',
  'transfer.request.acceptAll': '接受全部',
  'transfer.request.rejectAll': '拒绝全部',
  'transfer.toast.receiving': '{name} 正在向你上传 {count} 个文件',

  // ==================== 首连确认（spec 决策 6） ====================
  'transfer.consent.title': '连接请求',
  'transfer.consent.body': '{name} 想与你建立文件传输连接',
  'transfer.consent.namelessHint': '未能获取设备名称，请核对设备指纹后再决定',
  'transfer.consent.fingerprintLabel': '设备指纹',
  'transfer.consent.copy': '复制指纹',
  'transfer.consent.copied': '已复制',
  'transfer.consent.copyHint': '复制完整指纹，便于在另一台设备上比对',
  'transfer.consent.countdown': '将在 {seconds} 秒后自动拒绝',
  'transfer.consent.accept': '接受并信任',
  'transfer.consent.trustHint': '接受后此设备会加入信任表，以后连接不再询问。',
  'transfer.consent.deny': '拒绝',
  'transfer.consent.close': '关闭（等同拒绝）',

  // ==================== 可信对端管理（spec 决策 8） ====================
  'transfer.trusted.title': '可信对端',
  'transfer.trusted.loading': '加载中...',
  'transfer.trusted.empty': '暂无可信对端；首次连接经对方确认后建立信任',
  'transfer.trusted.loadFailed': '可信对端列表加载失败',
  'transfer.trusted.retry': '重试',
  'transfer.trusted.addedAt': '加入时间：{time}',
  'transfer.trusted.revoke': '撤销',
  'transfer.trusted.cancel': '取消',
  'transfer.trusted.revokeTitle': '撤销信任',
  'transfer.trusted.revokeBody':
    '撤销后，{name} 再次连接时需要重新经过你的确认。确定撤销对该设备的信任吗？',
  'transfer.trusted.revokeFailed': '撤销失败，请稍后重试',

  // ==================== 队列汇总 ====================
  'transfer.summary.active': '{count} 传输中',
  'transfer.summary.queued': '{count} 排队',
  'transfer.summary.failed': '{count} 失败',
  'transfer.summary.rejected': '{count} 同名被拒',
  'transfer.summary.speed': '合计 {speed}/s',

  // ==================== 设置 ====================
  'transfer.settings.sharedRoots': '共享目录',
  'transfer.settings.addRoot': '添加目录',
  'transfer.settings.removeRoot': '移除',
  'transfer.settings.noRoots': '尚未添加共享目录',
  'transfer.settings.downloadDir': '下载目录',
  'transfer.settings.noDownloadDir': '未设置',
  'transfer.settings.chooseDir': '选择目录',
  'transfer.settings.concurrency': '并发数',
  'transfer.settings.concurrencyHint': '同时传输的任务数量，增大可能占用更多带宽',
  'transfer.settings.encryptionNotice':
    '传输始终启用端到端加密（AES-256-GCM）；不支持加密的旧版本对端会显性失败，不会降级为明文',
  'transfer.settings.concurrencyMinus': '减少并发数',
  'transfer.settings.concurrencyPlus': '增加并发数',
  'transfer.settings.receivingPolicy': '接收策略',
  'transfer.settings.receivingPolicyAsk': '每次询问',
  'transfer.settings.receivingPolicyAccept': '直接接收',
  'transfer.settings.receivingPolicyReject': '直接拒绝',
  'transfer.settings.receivingPolicyHint': '对端发送文件前是否需要你同意',
  'transfer.settings.approvalTimeout': '同意超时（秒）',
  'transfer.settings.encryption': '传输加密',
  'transfer.settings.encryptionAlwaysOn': '始终加密',
  'transfer.settings.encryptionHint':
    '所有发送（内网直连 / 外网中继）都强制加密，无关闭开关；对端需为支持加密的新版本',
  // T12: 中继开关与提示阈值（关的是中继，不是加密）
  'transfer.settings.relay': '中继（外网）',
  'transfer.settings.relayOn': '允许',
  'transfer.settings.relayOff': '仅内网',
  'transfer.settings.relayThreshold': '中继提示阈值（MB）',
  'transfer.settings.relayThresholdHint':
    '经中继发送且本批不小于该大小时提示一次；0 = 每次经中继都提示',

  // ==================== 中继发送提示 ====================
  'transfer.relayHint.title': '正在经中继发送',
  'transfer.relayHint.body': '当前连接经中继转发，大文件可能较慢；加密保持开启。是否继续本次发送？',
  'transfer.relayHint.confirm': '继续发送',
  'transfer.relayHint.cancel': '取消',

  // ==================== 内网穿透配置（设置页，只读 + 分享） ====================
  'transfer.relayConfig.title': '内网穿透配置',
  'transfer.relayConfig.loading': '正在读取穿透配置…',
  'transfer.relayConfig.loadFailed': '读取穿透配置失败，请重试',
  'transfer.relayConfig.refresh': '重新读取',
  'transfer.relayConfig.empty': '还没有中继：去「内网穿透」导入地址，或扫另一台设备的分享二维码。',
  'transfer.relayConfig.source': '配置来源',
  'transfer.relayConfig.sourceCenter': '配置中心',
  'transfer.relayConfig.sourceCache': '本机缓存（中心不可用）',
  'transfer.relayConfig.sourceInvite': '邀请导入',
  'transfer.relayConfig.sourceQr': '扫码导入',
  'transfer.relayConfig.sourceSync': '内网同步获取',
  'transfer.relayConfig.sourceUnknown': '未标注',
  'transfer.relayConfig.relayState': '中继状态',
  'transfer.relayConfig.stateIdle': '未启用',
  'transfer.relayConfig.stateConnecting': '连接中…',
  'transfer.relayConfig.stateReserved': '已就绪',
  'transfer.relayConfig.stateLost': '已断开（重试中）',
  'transfer.relayConfig.stateUnknown': '未知',
  'transfer.relayConfig.wanPolicy': '对外网',
  'transfer.relayConfig.wanAllowed': '允许经中继',
  'transfer.relayConfig.wanBlocked': '仅内网（已关闭中继）',
  'transfer.relayConfig.room': '空间码',
  'transfer.relayConfig.syncedAt': '获取时间',
  'transfer.relayConfig.copy': '复制',
  'transfer.relayConfig.copied': '已复制',
  'transfer.relayConfig.copyFailed': '复制失败',
  'transfer.relayConfig.showAddr': '显示地址',
  'transfer.relayConfig.hideAddr': '隐藏地址',
  'transfer.relayConfig.centerError': '「内网穿透」配置中心不可用，正在使用本机缓存：{message}',
  'transfer.relayConfig.openCenter': '打开内网穿透',
  'transfer.relayConfig.openCenterUnavailable':
    '当前宿主不支持应用间跳转；请从侧边栏打开「内网穿透」。',
  'transfer.relayConfig.share': '生成分享二维码',
  'transfer.relayConfig.shareRelayMissing': '还没有可分享的中继地址',
  'transfer.relayConfig.shareFailed': '生成分享二维码失败，请重试',
  'transfer.relayConfig.shareHint':
    '用手机「文件传输 → 设置 → 内网穿透配置 → 扫码导入配置」扫描此二维码。',

  // ==================== 错误（spec §10 + v2 拒绝原因） ====================
  'transfer.error.duplicateName': '无法上传：目标目录已存在同名文件',
  'transfer.error.remoteChanged': '远端文件已变化，无法续传，请重新传输',
  'transfer.error.dirUnavailable': '该目录当前不可用',
  'transfer.error.rejectedByUser': '对方拒绝了传输',
  'transfer.error.noResponse': '对方未响应，请求已超时',
  'transfer.error.policyDenied': '对方设置了直接拒绝',
  // ADR 0030 业务错误码（guest bail_with_code!）
  'transfer.error.queueFull': '发送队列已满，请稍后再试',
  // 发送失败兜底（resolvePluginErrorText fallbackKey）
  'transfer.error.sendFailed': '发送失败，请重试',

  // ==================== 传输历史（v2） ====================
  'transfer.history.title': '历史',
  'transfer.history.clear': '清空历史',
  'transfer.history.clearConfirmTitle': '清空传输历史？',
  'transfer.history.clearConfirmBody':
    '将删除全部已完成、失败与被取消的记录（进行中的任务不受影响），此操作不可撤销。',
  'transfer.history.empty': '暂无传输历史',
  'transfer.history.openFolder': '打开所在文件夹',
  'transfer.history.results.completed': '已完成',
  'transfer.history.results.failed': '失败',
  'transfer.history.results.rejected': '已拒绝',
  'transfer.history.results.cancelled': '已取消',

  // ==================== 空态 ====================
  'transfer.empty.noRoots': '请先在设置中配置共享目录',
  'transfer.empty.noRootsHint': '添加一个本机目录作为共享根，对端即可浏览并下载其中的文件',
  'transfer.empty.noPeer': '未检测到已配对设备',
  'transfer.empty.noPeerHint': '确保手机与电脑在同一局域网，且手机端已配对并开启共享',
  'transfer.empty.noDownloadDir': '请先在设置中配置下载目录',
  'transfer.empty.noDownloadDirHint': '选择接收文件的保存位置，之后就能从对端下载文件到本机',
  // ==================== 剩余时间 ====================
  'transfer.eta.seconds': '剩 {count} 秒',
  'transfer.eta.minutes': '剩 {count} 分 {seconds} 秒',
  'transfer.eta.hours': '剩 {count} 小时 {minutes} 分',

  // ==================== 多任务卡片预览面（mountPreview · 2026-10-20） ====================
  'transfer.preview.peersTitle': '对端',
  'transfer.preview.noPeers': '暂无对端',
  'transfer.preview.morePeers': '还有 {count} 个对端',
  'transfer.preview.tasksTitle': '当前任务',
  'transfer.preview.moreTasks': '还有 {count} 项任务',

  // ==================== 全局通知（文案逐字取自宿主 `common.notification.*`） ====================
  'transfer.notification.peerConnected': '"{name}" 已建立连接',
  'transfer.notification.peerDisconnected': '"{name}" 已断开连接',
}

export default zhCN

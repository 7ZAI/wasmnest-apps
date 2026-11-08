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
  'transfer.devices.empty': '未发现附近设备；请确认对方已打开 WasmNest 并接入同一网络',
  'transfer.devices.online': '在线',
  'transfer.devices.recentSeen': '最近可见',
  'transfer.devices.connected': '已连接',
  'transfer.devices.connecting': '连接中…',
  'transfer.devices.capNone': '不支持传输',
  'transfer.devices.activeCurrent': '当前设备',
  'transfer.devices.setActive': '设为当前',
  'transfer.devices.connect': '连接',
  'transfer.devices.disconnect': '断开',
  'transfer.devices.denied': '对方拒绝了连接',
  'transfer.devices.unreachable': '无法连接，设备可能已离线',
  'transfer.devices.trustHint': '首次连接需对方确认；信任管理见 设置 → 可信对端',
  'transfer.devices.scan': '探索发现',
  'transfer.devices.scanning': '探索中…',
  // T12: 中继 / 远程设备（连接串导入、传输形态、手动尝试外网）
  'transfer.devices.addRemote': '添加远程设备',
  'transfer.devices.remote': '远程',
  'transfer.devices.removeRemote': '移除',
  'transfer.devices.tryWan': '尝试外网',
  'transfer.devices.tryWanHint': '只有你显式点击才尝试中继；同网段不可达不会自动切换',
  'transfer.devices.transportLan': '内网直连',
  'transfer.devices.transportWan': '外网中继',

  // ==================== 顶栏 ====================
  'transfer.topbar.sendToPhone': '发送到手机…',
  'transfer.topbar.downloadSelected': '下载所选 ({count})',
  'transfer.topbar.refresh': '刷新',
  'transfer.topbar.settings': '设置',
  'transfer.topbar.closeSettings': '返回',

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
  'transfer.consent.accept': '接受',
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
  'transfer.trusted.revokeBody': '撤销后，{name} 再次连接时需要重新经过你的确认。确定撤销对该设备的信任吗？',
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
  'transfer.settings.relayHint': '允许中继只是把 relay 候选加入拨号；两种状态下加密都保持开启',
  'transfer.settings.relayThreshold': '中继提示阈值（MB）',
  'transfer.settings.relayThresholdHint':
    '经中继发送且本批不小于该大小时提示一次；0 = 每次经中继都提示',

  // ==================== 中继发送提示 ====================
  'transfer.relayHint.title': '正在经中继发送',
  'transfer.relayHint.body':
    '当前连接经中继转发，大文件可能较慢；加密保持开启。是否继续本次发送？',
  'transfer.relayHint.confirm': '继续发送',
  'transfer.relayHint.cancel': '取消',

  // ==================== 添加远程设备 ====================
  'transfer.remote.title': '添加远程设备',
  'transfer.remote.hint':
    '粘贴对方设备生成的配对连接串（wasmnest://pair/…）或原始 JSON 载荷。载荷只含一次性票据，不含长期密钥。',
  'transfer.remote.placeholder': 'wasmnest://pair/… 或 {"nodeId":"…","addrs":["…"]}',
  'transfer.remote.cancel': '取消',
  'transfer.remote.confirm': '添加',
  'transfer.remote.added': '已添加远程设备',
  'transfer.remote.errorMalformed': '连接串或 JSON 无效',
  'transfer.remote.errorIncomplete': '配对信息不完整（需要 nodeId 与至少一个地址）',
  'transfer.remote.errorAddressInvalid': '地址不可拨号（需为 /multiaddr 形态）',

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
  'transfer.history.clearConfirmBody': '将删除全部已完成、失败与被取消的记录（进行中的任务不受影响），此操作不可撤销。',
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

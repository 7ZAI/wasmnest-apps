/**
 * 简体中文文案（域消息表；key 由 index.ts 补 `com.wasmnest.news.` 前缀）
 *
 * 这里是文案真源：`messages.ts` 的类型与 `en.ts` 的完整性都以本表为准，
 * 新增 key 时英文表缺项会直接编译失败。
 */
const zhCN = {
  // ==================== 视图 ====================
  'news.view.today': '今日',
  'news.view.circles': '圈子',
  'news.view.realtime': '实时',
  'news.view.saved': '收藏',
  'news.view.ungrouped': '未分组',
  'news.view.allCircles': '全部',

  // ==================== 工具栏 ====================
  'news.toolbar.refresh': '刷新',
  'news.toolbar.refreshing': '正在刷新',
  'news.toolbar.settings': '设置',
  'news.toolbar.close': '关闭',
  'news.toolbar.markAllRead': '全部已读',
  'news.toolbar.back': '返回',
  'news.toolbar.search': '搜索',

  // ==================== 列表头 ====================
  'news.feed.todayHint': '过去 24 小时，按热度排序',
  'news.feed.circlesHint': '按圈子过滤，组内按热度排序',
  'news.feed.realtimeHint': '最近 6 小时，按首次抓到时间排序',
  'news.feed.savedHint': '收藏的条目，永不被清理',
  'news.feed.cutoff': '数据截止 {time}',
  'news.feed.count': '{count} 条',

  // ==================== 空态 ====================
  'news.feed.emptyToday.title': '过去 24 小时还没有内容',
  'news.feed.emptyToday.body': '添加一个源，或点刷新抓取最新内容。',
  'news.feed.emptyCircles.title': '这个圈子还没有内容',
  'news.feed.emptyCircles.body': '把源挂进这个圈子，或换一个圈子看看。',
  'news.feed.emptyRealtime.title': '最近 6 小时没有新内容',
  'news.feed.emptyRealtime.body': '源状态在下方；可以点刷新立即抓取。',
  'news.feed.emptySaved.title': '还没有收藏',
  'news.feed.emptySaved.body': '打开条目详情，点收藏把它留在这里。',
  'news.feed.addSource': '添加源',
  'news.feed.emptySourcesTitle': '已添加的源',
  'news.feed.emptySourcesBody': '这些源暂时没有内容。点刷新重抓，或到设置里检查地址与授权。',

  // ==================== 卡片 ====================
  'news.card.sources': '{count} 个来源',
  'news.card.unread': '未读',

  // ==================== 详情 ====================
  'news.detail.title': '条目详情',
  'news.detail.summary': '摘要',
  'news.detail.noSummary': '这条内容没有摘要，可复制链接到浏览器阅读原文。',
  'news.detail.origins': '来源（{count}）',
  'news.detail.copy': '复制链接',
  'news.detail.favorite': '收藏',
  'news.detail.unfavorite': '取消收藏',
  'news.detail.markRead': '标记已读',
  'news.detail.markUnread': '标记未读',
  'news.detail.openHint': '应用内不打开原文，请复制链接到浏览器查看。',
  'news.detail.assistantFetch': '用助手抓取',
  'news.detail.assistantUnavailable': '当前宿主助手未提供该能力',
  'news.detail.copyFallbackTitle': '无法自动复制，请手动选择下面的链接',
  'news.detail.copyFallbackClose': '知道了',
  'news.detail.read': '阅读全文',
  'news.detail.back': '返回摘要',
  'news.detail.archive': '保存到本机',
  'news.detail.archived': '已归档',
  'news.detail.readerHint': '正文只存本机，图片不缓存；站点可能要求登录或付费。',

  // ==================== 阅读态 ====================
  'news.reader.loading': '正在抓取并解析正文，请稍候…',
  'news.reader.retry': '重试',
  'news.reader.copy': '复制链接',
  'news.reader.source': '原文链接',
  'news.reader.stale': '更新失败，显示上次抓取的正文',
  'news.reader.truncated': '正文过长，已截断显示',
  'news.reader.settingsLoadFailed': '读取阅读设置失败，已按上次状态或默认开启显示。',
  'news.reader.openSettings': '去设置',

  // ==================== 设置 ====================
  'news.settings.title': '新闻设置',
  'news.settings.tab.sources': '源',
  'news.settings.tab.circles': '圈子',
  'news.settings.tab.ai': 'AI 摘要',
  'news.settings.tab.log': '抓取记录',
  'news.settings.tab.data': '数据',
  'news.settings.tab.about': '关于',

  // ==================== 源 ====================
  'news.settings.sources.add': '添加源',
  'news.settings.sources.edit': '编辑',
  'news.settings.sources.empty': '还没有源。添加一个 RSS 地址开始。',
  'news.settings.sources.delete': '删除源',
  'news.settings.sources.deleteConfirm': '删除「{name}」？它抓到的条目若没有其它来源会从列表消失。',
  'news.settings.sources.enabled': '启用',
  'news.settings.sources.disabled': '已停用',
  'news.settings.sources.weight': '权重',
  'news.settings.sources.circle': '圈子',
  'news.settings.sources.neverFetched': '未抓取',
  'news.settings.sources.lastOk': '上次成功 {time}',
  'news.settings.sources.nextRetry': '下次重试 {time}',
  'news.settings.sources.failing': '连续失败 {count} 次',
  'news.settings.sources.experimental': '实验性',
  'news.settings.sources.credentialMissing': '缺少凭据',
  'news.settings.sources.retry': '立即重试',
  'news.settings.sources.netAuthHint':
    '自定义域名在移动端首次访问会触发宿主授权询问；拒绝后在此点「立即重试」，不要当成空源。',
  'news.settings.sources.kind.rss': 'RSS / Atom',
  'news.settings.sources.kind.hn': 'Hacker News',
  'news.settings.sources.kind.reddit': 'Reddit 榜单',
  'news.settings.sources.kind.github-trending': 'GitHub Trending',
  'news.settings.sources.kind.youtube-rss': 'YouTube 频道',
  'news.settings.sources.kind.x-graphql': 'X（实验性）',
  'news.settings.sources.kind.ig-graphql': 'Instagram（实验性）',
  'news.settings.sources.kind.html-list': 'HTML 榜单（内置）',

  // ==================== 源表单 ====================
  'news.settings.sourceForm.name': '名称',
  'news.settings.sourceForm.url': '地址',
  'news.settings.sourceForm.kind': '种类',
  'news.settings.sourceForm.weight': '权重（0.5 – 2.0）',
  'news.settings.sourceForm.circle': '所属圈子',
  'news.settings.sourceForm.credential': '凭据',
  'news.settings.sourceForm.save': '保存',
  'news.settings.sourceForm.cancel': '取消',
  'news.settings.sourceForm.nameRequired': '请填写名称',
  'news.settings.sourceForm.urlRequired': '请填写地址',
  'news.settings.sourceForm.invalidUrl': '地址必须是 http(s) 开头的完整链接',
  'news.settings.sourceForm.duplicateUrl': '这个地址已经添加过了',
  'news.settings.sourceForm.authRequired': '实验性源需要先添加并选择凭据',
  'news.settings.sourceForm.youtubeHint': '填频道页（/channel/UC…）或 feeds/videos.xml 地址',
  'news.settings.sourceForm.redditHint': '填 r/子版 或完整 .json 地址',
  'news.settings.weight.increase': '增加权重',
  'news.settings.weight.decrease': '减少权重',

  // ==================== 圈子 ====================
  'news.settings.circles.add': '新建圈子',
  'news.settings.circles.edit': '编辑圈子',
  'news.settings.circles.name': '名称',
  'news.settings.circles.weight': '权重（0.5 – 2.0）',
  'news.settings.circles.sources': '{count} 个源',
  'news.settings.circles.empty': '还没有圈子。圈子用来给不同兴趣分组，并影响排序。',
  'news.settings.circles.delete': '删除圈子',
  'news.settings.circles.deleteConfirm': '删除「{name}」？它下面的源会回到「未分组」，条目保留。',
  'news.settings.circles.nameRequired': '请填写圈子名称',
  'news.settings.circles.duplicate': '已有同名圈子',

  // ==================== 凭据 ====================
  'news.settings.credentials.title': '凭据（实验性源）',
  'news.settings.credentials.add': '添加凭据',
  'news.settings.credentials.edit': '编辑凭据',
  'news.settings.credentials.label': '标签',
  'news.settings.credentials.cookie': 'Cookie',
  'news.settings.credentials.bearer': 'Bearer token',
  'news.settings.credentials.csrf': 'CSRF token（可选）',
  'news.settings.credentials.secretRequired': '请至少填 Cookie 或 Bearer token',
  'news.settings.credentials.masked': '已保存：{mask}',
  'news.settings.credentials.plaintext':
    '凭据以明文保存在本机（宿主没有系统密钥环），不会写入日志、错误信息或导出文件。',
  'news.settings.credentials.delete': '删除凭据',
  'news.settings.credentials.deleteConfirm': '删除凭据「{label}」？引用它的源会变成「缺少凭据」。',

  // ==================== AI ====================
  'news.settings.ai.enabled': '启用 AI 摘要',
  'news.settings.ai.baseUrl': '端点（OpenAI 兼容）',
  'news.settings.ai.model': '模型',
  'news.settings.ai.apiKey': 'API Key',
  'news.settings.ai.keySaved': '已保存：{mask}',
  'news.settings.ai.keyHint': '留空表示不修改已保存的 Key',
  'news.settings.ai.plaintext':
    'API Key 以明文保存在本机（宿主没有系统密钥环），日志只记录长度，不记录内容。',
  'news.settings.ai.save': '保存设置',
  'news.settings.ai.saved': '已保存',
  'news.settings.ai.summarizeToday': '为今日前 20 条生成摘要',
  'news.settings.ai.summarizing': '正在生成 {done}/{total}',
  'news.settings.ai.disabled': 'AI 摘要在关闭状态不会发出任何请求',
  'news.settings.ai.configureFirst': '请先填写端点、模型与 Key',
  'news.settings.ai.result': '成功 {ok} 条，失败 {failed} 条',
  'news.settings.ai.itemResult': '{name}：{result}',

  // ==================== 抓取记录 ====================
  'news.settings.log.title': '最近 200 条抓取记录',
  'news.settings.log.empty': '还没有抓取记录。',
  'news.settings.log.source': '源',
  'news.settings.log.time': '时间',
  'news.settings.log.duration': '耗时',
  'news.settings.log.items': '条目',
  'news.settings.log.result': '结果',
  'news.settings.log.ok': '成功',
  'news.settings.log.failed': '失败',

  // ==================== 数据 ====================
  'news.settings.data.export': '导出 JSON',
  'news.settings.data.exportHint':
    '导出包含源、圈子、已读与收藏状态；明确排除凭据与 AI 密钥。',
  'news.settings.data.exported': '导出内容已生成，可直接下载或复制',
  'news.settings.data.download': '下载文件',
  'news.settings.data.copy': '复制 JSON',
  'news.settings.data.summary': '{sources} 个源 · {circles} 个圈子',

  // ==================== 阅读 ====================
  'news.settings.reader.title': '阅读',
  'news.settings.reader.enabled': '在应用内阅读全文',
  'news.settings.reader.hint':
    '开启后可抓取原文正文并在应用内阅读。正文只存本机，图片不缓存；站点可能要求登录或付费。',
  'news.settings.reader.usage': '缓存 {cachedCount} 篇 · 归档 {archivedCount} 篇',
  'news.settings.reader.bytes': '占用 {bytes}',
  'news.settings.reader.clearCache': '清除阅读缓存',
  'news.settings.reader.clearAll': '清空全部正文',
  'news.settings.reader.clearCacheConfirm': '删除所有未归档正文？',
  'news.settings.reader.clearAllConfirm':
    '删除全部正文（含归档）？收藏状态不变，之后可重新抓取。',
  'news.settings.reader.cleared': '已清除 {count} 篇（{bytes}）',
  'news.settings.reader.confirm': '确定',
  'news.settings.reader.cancel': '取消',

  // ==================== 自启 ====================
  'news.settings.autostart.title': '自动启动',
  'news.settings.autostart.on': '开',
  'news.settings.autostart.off': '关',
  'news.settings.autostart.unknown': '由宿主管理',
  'news.settings.autostart.pathDesktop': '主屏 → 系统应用 → news → 自启',
  'news.settings.autostart.pathMobile': '应用详情 → 自启',
  'news.settings.autostart.note':
    '应用内只能查看，不能修改；请按上面的路径在宿主里开启。开启后重启宿主，定时抓取才会在未打开界面时继续。',

  // ==================== 关于 ====================
  'news.settings.about.version': '版本 {version}',
  'news.settings.about.differencesTitle': '双端差异',
  'news.settings.about.differences':
    '桌面：激活期每 15 分钟自动抓取一次，复制链接走系统剪贴板。移动：没有宿主定时器，靠打开应用、回到前台与下拉刷新补抓；复制走浏览器剪贴板，失败时给出可选文本。',
  'news.settings.about.noNotifications':
    'v1 不发系统通知，也不内嵌网页阅读原文。',

  // ==================== 状态条与横幅 ====================
  'news.status.title': '源状态',
  'news.status.empty': '还没有启用的源',
  'news.status.never': '从未抓取',
  'news.status.failing': '失败',
  'news.status.ok': '正常',
  'news.status.backoff': '退避中',
  'news.banner.failed': '{count} 个源抓取失败',
  'news.banner.openSettings': '查看源',
  'news.banner.blocked': '刷新太频繁，请稍后再试',

  // ==================== 错误分类文案 ====================
  'news.error.loadFeed': '读取列表失败：{detail}',
  'news.error.net.denied': '未授权访问该域名',
  'news.error.net.failed': '网络不可达',
  'news.error.http.status': '源返回 HTTP 错误',
  'news.error.auth.expired': '需要重新登录',
  'news.error.parse.no_feed': '这不是可识别的订阅流',
  'news.error.parse.unexpected_shape': '源结构可能已变更',
  'news.error.rate.limited': '请求被限流',
  'news.error.ai.auth': 'AI 端点鉴权失败',
  'news.error.ai.failed': 'AI 请求失败',
  'news.error.ai.disabled': 'AI 摘要未开启',
  'news.error.assistant.fetch-unavailable': '当前宿主助手未提供该能力',
  'news.error.invalid.argument': '参数不合法',
  'news.error.source.unavailable': '源不存在或已停用',
  'news.error.port.unsupported': '本端不支持该能力',
  'news.error.storage.failed': '本地存储访问失败',
  'news.error.clock.unavailable': '无法获取当前时间',
  'news.error.refresh.debounced': '刷新太频繁，请稍后再试',
  'news.error.reader.disabled': '阅读功能未开启',
  'news.error.extract.unsupported': '这不是可阅读的网页（可能是 PDF / 视频 / JSON）',
  'news.error.extract.no_content':
    '没能提取到正文（站点可能需要登录、付费，或结构不受支持）',
  'news.error.extract.encoding': '页面编码无法解析',
  'news.error.extract.too_large': '页面过大，无法完整读取',
  'news.error.extract.failed': '正文解析失败',
  'news.error.reader.storage_full': '本机正文存储已达上限，请清理',
  'news.error.unknown': '未知错误',

  // ==================== 提示 ====================
  'news.toast.copied': '链接已复制',
  'news.toast.copyFailed': '复制失败，请手动选择链接',
  'news.toast.refreshed': '刷新完成：{newItems} 条新增',
  'news.toast.markedAllRead': '已把 {count} 条标为已读',
  'news.toast.saved': '已保存',
  'news.toast.deleted': '已删除',
  'news.toast.aiDone': '摘要完成：成功 {ok} 条',
  'news.toast.sourceDisabled': '源已停用',
  'news.toast.readerArchived': '正文已保存到本机',

  // ==================== 相对时间 ====================
  'news.relative.justNow': '刚刚',
  'news.relative.minutes': '{count} 分钟前',
  'news.relative.hours': '{count} 小时前',
  'news.relative.days': '{count} 天前',

  // ==================== 多任务卡片预览面 ====================
  'news.preview.title': '新闻',
  'news.preview.empty': '暂无内容',
}

export default zhCN

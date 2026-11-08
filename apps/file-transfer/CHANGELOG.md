# Changelog

本文件记录 **File Transfer**（`com.wasmnest.file-transfer`）的版本变更。桌面与移动端共用同一版本号、同一份 Rust 产物与发布 tag。

- 版本真源：`apps/file-transfer/{desktop,mobile}/plugin.json` 的 `version`，双端必须一致。
- 发布 tag：`file-transfer-v<X.Y.Z>`；发布流程见 [`docs/CI.md`](../../docs/CI.md) §2。
- 结构参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
- 发布时把 `[Unreleased]` 收为 `## [<version>] - <YYYY-MM-DD>`，与版本号、tag 同一批提交。

## [Unreleased]

### 新增

- 应用内检查更新：双端接入宿主 `appUpdate`，`plugin.json` 声明 GitHub Release 更新源。
- 远程设备接入（内网穿透 T12）：双端「添加远程设备」粘贴配对连接串
  `wasmnest://pair/<base64url>` / 纯 JSON（只含 `nodeId` + 多地址 + 可选一次性票据，不含长期密钥）；
  手动添加的设备按 nodeId 持久化（`addrs` + `paired`），不参与 mDNS 过期清扫。
- 多地址拨号（`dial-peer-addrs`）：LAN 候选优先、relay 候选仅在显式「尝试外网」或没有 LAN 候选时纳入；
  设备行显示宿主上报的真实传输形态「内网直连 / 外网中继」，断开即清除。
- 中继设置：允许中继（缺省开；关闭只影响拨号候选，**不影响加密**）与「中继提示阈值」（MB，0 = 每次提示）；
  经中继发送前按阈值给一次可取消的「可能较慢」提示，不改变模式判定。

### 修复

- 节点启动声明固定端口（47613），NodePower 配置构造收敛到单点。服务租约路径（双端生产装配）暂不读取该配置，节点仍由宿主全局默认端口 47613 起；无租约装配（无头 / 测试）才按声明值生效。

### 安全

- i18n 消息改为构建期预编译，移除运行时编译与 CSP `unsafe-eval` 前提（安全审查 #50）。
- 传输加密固定开启（内网 / 中继都强制，UI 无关闭入口）；旧对端不支持加密时显性失败，无明文回退。

## [0.0.1] - 2026-10-27

### 新增

- 设备发现：在线对端自动发现与切换，首连确认建立信任。
- 远程目录浏览与多任务并发传输（并发数可调）。
- 传输队列：暂停 / 恢复 / 断点续传 / 失败重试 / 取消，失败原因明示。
- 共享目录：本地目录挂载（可多个）供对端访问。
- 接收策略：逐批批准 / 自动接受 / 自动拒绝，可设批准超时。
- 可信设备与撤销；信任 / consent 决策经 `servers/auth-center` 互调。
- 传输历史与打开所在文件夹。
- 移动端三页签（传输 / 浏览 / 设备）：浏览共享目录多选下载，手机文件经共享目录上传，长按「保存到…」自选保存位置。
- 桌面 + 移动双端发布，双端加载同一份 wasm 产物；桌面端支持多任务卡片只读预览（`mountPreview`）。

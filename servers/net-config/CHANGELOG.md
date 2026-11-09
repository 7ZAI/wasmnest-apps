# Changelog

本文件记录 **Network Config**（`com.wasmnest.net-config`）的版本变更。

- 版本真源：`servers/net-config/desktop/plugin.json` 的 `version`。
- 发布 tag：`net-config-v<X.Y.Z>`；发布流程见 [`docs/CI.md`](../../docs/CI.md) §2。
- 结构参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
- 发布时把 `[Unreleased]` 收为 `## [<version>] - <YYYY-MM-DD>`，与版本号、tag 同一批提交。

## [Unreleased]

## [0.0.1] - 2026-11-09

### 新增

- 穿透配置中心抽为 `servers/net-config` 独立服务（T18）：把 relay 地址从各应用私有配置提升为跨应用唯一真源，并维护按插件 id 的「是否允许外网」注册表。
- 页面 `/network`：当前中转配置（PeerId / 本地复算指纹 / 准入 / 配额 / 地址 / 来源）、部署文本生成（Compose / Docker / systemd）、地址导入（JSON / 文本 / multiaddr，版本与协议不匹配显性拒绝）、连通性探测出路（宿主原语未装配时显性禁用）、业务 WAN 注册表。
- 插件 KV `network.relay`（沿用 T14 `version:1` 形态）与 `network.wanPolicy`；损坏只报错、不静默清除，显式移除才删键。
- 互调 api：`relay-config` / `wan-policy` 只读；`relay-adopt` 幂等收养（目标已有值不覆盖，供 BedCode 迁移）。
- 支持多任务卡片只读预览（`mountPreview`）。

### 变更

- BedCode 设置页「中转服务器」卡片退役为只读入口（跳 `/network`）；T14 的解析、部署文本与 40 条行为契约迁入本服务，BedCode 不再保留副本。
- BedCode 隧道配置改为显式地址入参（来自本中心，本地 KV 仅作中心不可用时的缓存）。

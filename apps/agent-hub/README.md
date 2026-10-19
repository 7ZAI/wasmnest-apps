# Agent Hub（`com.wasmnest.agent-hub`）

Agent CLI 统一管理台：对 claude / codex / opencode / pi 四种 Agent CLI 做环境检测、一键安装/卸载与更新，统一管理 Skills、供应商配置、使用统计与会话日志。

支持端：桌面（宿主侧边栏「Agent Hub」入口）

## 功能特性

- **环境概览**：系统 / Node / npm / pnpm / Python / npm 源检测，四款 CLI 安装状态一目了然
- **一键安装与卸载**：卡片式管理各 CLI，支持检测更新；npm 源测速与一键切换（官方 / npmmirror / 华为云 / 腾讯云 / Yarn / 自定义）
- **Skills 管理**：浏览 / 编辑 / 分发，支持 GitHub 安装与本地导入
- **供应商配置**：统一配置各 CLI 的供应商（API 地址 / 密钥 / 模型）
- **使用统计**：会话次数、时长等图表（趋势 / 环形 / 热力图）
- **会话日志**：解析各 CLI 的会话日志并落库，可追溯查询

## 使用方式

宿主侧边栏「Agent Hub」→ 概览页查看各 CLI 安装状态与环境信息，卡片上一键卸载；安装与更新在「安装与更新」页操作；Skills 的浏览 / 编辑 / 分发、GitHub 安装、本地导入在「Skills」页操作。

> 首次使用相关能力前，需要授权 CLI 配置目录（`~/.codex`、`~/.pi`、opencode 等），未授权时相关能力暂不可用。

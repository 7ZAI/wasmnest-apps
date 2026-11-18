# 移动端 API Key 明文存插件存储，并明确警告；secret-store 缺口单独立项

**状态**：accepted（2026-11-07）

## 背景与问题

`servers/speech` 是公共服务：调用方传音频、拿文本，**Key 归服务持有**（否则服务退化成公共 HTTP 代理）。所以服务必须能存一张云厂商 Key。

WasmNest 的宿主能力在双端**不对称**：

- 桌面：`auth` 权限提供 `auth_secret_get / set / delete / keys`（`plugin-sdk-desktop/rust/src/host/auth.rs:31-40`），凭据落主库 `plugin_secrets` 表、按插件属主隔离、明文不落插件 KV。这是正确的地方。
- 移动：`host-auth` 是**设备入场认证引擎面**（`plugin-sdk-mobile/rust/src/host/auth.rs:1-14`），原文「凭据零过境……本域不向插件返回任何凭据材料」；全仓无 `set_secret` / `get_secret`。**移动端没有任何可用的托管密钥存储。**

而本服务的要求是「双端同一个 wasm」——不能只在桌面实现 Key 托管。

## 决定

1. **桌面**：Key 存 secret-store（`auth_secret_set` / `auth_secret_get`），`settings_get` 永不回传明文，只回 `hasKey: bool`。
2. **移动**：Key 存 `storage`（插件私有存储，**明文落盘**），并且在写入前弹出**明确的一次性警告**：「移动端无系统级密钥存储，Key 以明文存于应用私有目录，仅本机使用」。用户确认才写入。
3. **跨仓缺口单独立项**：在能力仓 `wit/auth.wit` 为移动端补 secret-store（Android Keystore / iOS Keychain），配新权限位或复用 `auth`。这是一个独立 issue，不阻塞本服务 v1。

## 后果

**正面**：双端同一个 wasm 成立；桌面侧 Key 安全，移动侧风险可见且可控（Key 只在本机使用、不出插件私有目录）。

**负面**：移动端存在「Key 明文落盘」的已知妥协。任何能读到应用私有目录的途径（root、备份导出、调试构建）都能拿到 Key。这在研发起步期可以接受，但**必须在移动端补上 secret-store 后回落**，不能长期停留。

## 替代方案

- **移动端不支持云端识别**：直接把「双端同一个 wasm」变成空话，砍掉一半价值。否决。
- **等移动端 secret-store 就位再做**：把整个功能无限期挂起。否决。
- **Key 由调用方传入**：让每个应用自己持 Key，服务的价值退化为「协议适配器」，且 Key 面更大。否决。

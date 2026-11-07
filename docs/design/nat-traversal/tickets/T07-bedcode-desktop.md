# [feat] T07 · bedcode 桌面：隧道 expose、固定 `required` 加密、配对信任与撤销级联

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T06、T08（接口对齐，可并行开发）｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.1、§4.5、§4.10、§5.2、§0.4、不变量 7/12/16

## 需求描述

bedcode 桌面作为被访问方接入穿透：经对等面暴露服务（禁止裸转发 8765）、链加密固定 `required` 不可关闭、配对成功写入 peer 信任、撤销级联，并按 §0.4 裁定锁定三条免凭证路由的可达性。

## 落点 app 与端

`bedcode` / 桌面（rust + 前端设置页）。

## 验收条件

- [ ] `host-tunnel.expose({ port: 8765, kind: "http", ... })`（逻辑端口，后端恒为对等面）；「远程访问」开关（含 `allowWan` 语义）控制 expose 与 reservation 计数。
- [ ] **link-crypto 固定 `required`**：`useLinkCrypto.ts` 移除 off/preferred 选择，设置页改只读「强制加密」；配置层拒绝关闭；缺链路身份拒绝并提示修复（不变量 12/14）。
- [ ] 配对成功且 JWT 签发后，用 peer face 传来的**已验证** `peerNodeId` 写 peer 信任列表（不信任客户端自报值）；auth-center 配对记录保存该 nodeId（供 `allowedPeers` 与撤销）。
- [ ] 解配对/撤销设备同时 `host-peer.revoke-trusted`（不变量 7）；隧道 ACL 立即生效。
- [ ] **§0.4 测试锁**：`task-status`/`session-mode`/`terminal-bg` 经 peer face 仅对已匹配 peer 可达（匹配校验在隧道层）；run-* 四条对 `peer` 一律 403（不变量 3/16）。
- [ ] 状态 UI：设备页显示「互联网可达」、relay 延迟、加密状态；错误按 §7.1 词表显性呈现。
- [ ] 旧客户端不支持 link-crypto → 显性 `encryption-unsupported` + 升级提示，无明文回退。
- [ ] app `test:run` + 根 lint + `cargo test` + wasm 目标构建绿；真实宿主目验；交互面改动同步 `data-testid` 锚点。

## 相关契约与锁

- 依赖 T05 的 `host-tunnel` 绑定与 T03 的 `peerNodeId`/pairing 请求上下文。
- `hostAppBoundaryLock`：不动 `entry.ts` 边界；若动则平台桌面测试全量。
- i18n / E2E 锚点 / `docs/verification/bedcode.md` 同步（T10 收口）。
- §0.4 裁定用户可否决；否决则本 ticket 与 T05 返工。
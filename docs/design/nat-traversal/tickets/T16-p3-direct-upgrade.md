# [feat] T16 · P3：直连升级评估（QUIC/DCUtR、TCP 打洞、UPnP）

- **落仓**：`7ZAI/wasmnest-lib`
- **标签**：`kind:feature`
- **阶段**：P3 ｜ **依赖**：T15（relay 基线稳定）｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§2.4、§4.7、§9.1 风险 4

## 需求描述

在 relay 已连通的前提下评估直连升级，降低 relay 带宽与延迟。**评估先行，不承诺落地**；任何路径失败都必须回退 relay（不是明文公网直连），回退仍受匹配校验，不得导致功能或安全降级。

## 落点 app 与端

机制：`wasmnest-p2p-engine`；桌面可选 UPnP；Android 兼容性实测。

## 验收条件

- [ ] **QUIC/DCUtR 依赖评估**：`libp2p-quic 0.14` 的 `quinn` 写死 `rustls-aws-lc-rs`，与 Android 零 aws-lc 纪律冲突——给出 fork/patch 用 ring 或自管 QUIC 传输的可行性结论与工期估算。
- [ ] **identify 语义评估**：启用 identify 引入「准入放行前交换元信息」语义变化（引擎当前刻意不启用）；DCUtR 依赖 observed address，给出与准入闸门的兼容方案。
- [ ] **TCP 同时打开**：不引 QUIC 的打洞成功率实测（NAT 行为依赖 + Android 兼容性）。
- [ ] **UPnP/NAT-PMP（仅桌面）**：用户显式开启才尝试；只对支持的路由器有效；不作为承诺。
- [ ] 性能基准：直连成功率/吞吐对比 relay；失败自动回退 relay 的测试。
- [ ] Android 构建树仍零 rustls/aws-lc/openssl-sys。
- [ ] 评估报告：推荐路径 / 不推荐理由 / 后续 ticket 拆分建议。

## 相关契约与锁

- 不变量 6/9/10/11：回退不降级、匹配校验不放松、WAN 必须 Noise。
- P3 若启用 QUIC，relay 防火墙文档加 UDP 4001（T13 文档同步）。
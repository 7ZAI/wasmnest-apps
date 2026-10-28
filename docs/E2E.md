# E2E —— 真实宿主内的自动化功能测试

> **本文件是 E2E 的唯一说明入口**（单端桌面 §1–§9 / 双端真机 §10 / 真机单端 §11：怎么跑 / 怎么写 / 判据纪律 / 排障）。
> 规则裁决看 `AGENTS.md`；结构导航看 `docs/CODE-MAP.md`；单元测试规范看
> `../wasmnest/docs/public/testing.md`。
> 文档字面 ≠ 事实：改动脚本或流程后回来同步本文件。

---

## 1. 为什么有这一层

应用仓的验证分三层，E2E 补的是中间那层「**界面能不能用**」：

| 层 | 手段 | 覆盖 | 盲区 |
| --- | --- | --- | --- |
| 单元 | `pnpm run test:run`（vitest + happy-dom） | 纯函数 / composable / 组件逻辑 | 组件没挂载到真实宿主，事件链、路由、真实 wasm 往返都不在 |
| **E2E（本层）** | `node scripts/e2e.mjs --app <slug>` | **真实宿主 + 真实 wasm app + 真实点击** | 外部依赖（真实对端 / 真实 API key）需另备环境 |
| **双端 E2E**（§10） | `node scripts/e2e-dual.mjs --app <slug>` | 上一行 + **USB 真机**（真 WebView / 真触摸 / 真网络） | 只覆盖单台设备 + debug 产物；扫码 / 同网段发现不在范围内 |
| **真机单端 E2E**（§11） | `node scripts/e2e-mobile.mjs --app <slug>` | **真机 + 真移动宿主 + 真 wasm**（桌面不在场） | 只覆盖手机这一端；应用代码取自打进 APK 的那一份 |
| 人工 | 平台 `tauri:dev` 目验 | 全部 | 不可回归、不可重复、覆盖窄 |

E2E 的判据：**在真实桌面宿主里挂载真实 wasm app，用脚本点击界面并断言用户看得见的结果**。

---

## 2. 它是怎么跑起来的

```text
┌─ scripts/e2e.mjs（编排层 · 本仓）
│   1. 解析宿主（scripts/host-runtime.mjs）：显式 --host → 本机 host:pack 产物 → 下载缓存
│      并用 host-runtime.lock.json 比对 sdkVersion / witVersion / mountContract（不匹配即红）
│   2. 构建被测 app → `build.js --out <临时 staging>`（**不写平台宿主 resources**）
│   3. 预检驱动：tauri-driver / WebKitWebDriver
│   4. 仅 cargo 模式才起（或复用）宿主前端 dev server（vite :1420）
│   5. 设隔离环境：WASMNEST_PLUGINS_DIR=staging / XDG_DATA_HOME（可选）
│   6. 跑 wdio → 退出码即结论；临时 staging 无论成败都删
│
└─ e2e/wdio.conf.ts（驱动层 · 本仓）
    WDIO → @wdio/tauri-service → tauri-driver(Rust) → WebKitWebDriver → 宿主二进制
    宿主二进制**只认**运行器注入的 WASMNEST_E2E_HOST_BIN（本配置不再自行拼平台仓路径）
    宿主里的 tauri-plugin-wdio（仅 debug 构建注册）提供 `browser.tauri.execute`
```

### 两种宿主模式（CONTRACT §8.3；默认 `packed`）

| 模式 | 宿主来源 | 宿主前端 dev server | app 产物 / staging | 用途 |
| --- | --- | --- | --- | --- |
| `packed`（默认） | 解析器：`--host` / `WASMNEST_HOST_BIN` → 本机 `host:pack` 产物 → 下载缓存 | **不启**（前端已嵌进 `tauri build --debug` 产物） | `build.js --out <mkdtemp>`，就地使用，跑完删除 | **G2 验收形态**：只有应用仓也能跑完整前后端 E2E |
| `cargo` | `<平台仓>/wasmnest-desktop/src-tauri/target/debug/wasmnest-desktop` | 启（`devUrl` :1420） | 写平台宿主 resources，再拷进平台 target 下的 e2e 目录 | 平台仓内改宿主前端时的调试形态 |

> `runtime`（L2 通用 `wasmnest-desktop-runtime` 装出来的二进制）与 packed 共用 staging 逻辑，
> 只是宿主来源换成 `scripts/install-runtime.mjs --print`；见 A7 / CONTRACT §5.2。
>
> packed 与 cargo 的 **CSP 不同**（packed 用生产 `connect-src 'none'`，cargo 用 `devCsp`），
> 所以两条路都要各自实跑，不能拿一条的绿推断另一条。

> **逐 app 一次 wdio**：桌面宿主是**单实例**资源（端口 + 应用数据目录 + 窗口），
> 同一个 wdio run 里放多个 spec 文件会各自起 worker → 各自起宿主实例 → 第二个起不来
> （表现为「宿主 webview 未就绪」超时）。故运行器**每个 app 单独跑一次 wdio**，
> 每次宿主里只装这一个 app。全量模式 = 依次跑完每个 app，退出码合并。

**为什么 app 的界面能被脚本点到**：桌面 app 不是 iframe，而是经 `mountApp(root, env)`
把独立构建的 Vue 应用**挂进宿主 webview 的同一个 document**（宿主
`src/shell/mount/useAppMount.ts` + `AppMountSlot.vue` 的 `.app-mount-slot`）。所以
WebDriver 注入的脚本能直接访问 app 内部节点。

### 硬前置（缺任一 → 失败原因会伪装成「功能坏」）

| 前置 | 适用模式 | 判据 | 缺了会怎样 |
| --- | --- | --- | --- |
| 宿主**含 wdio 插件的二进制** | 全部 | packed：解析器给得出（`node scripts/fetch-host.mjs` 或本机 `host:pack`）；cargo：`src-tauri/target/debug/wasmnest-desktop` | wdio 插件只在 `#[cfg(debug_assertions)]` 注册，release 产物**没有**它（平台仓有锁测试保证） |
| 宿主前端 **dev server** | 仅 cargo | `http://localhost:1420/` 可达 | 不启服务时页面是 `about:blank` → 报 `Tauri plugin not available`（极易误判成「插件没装」）；packed 前端已嵌进二进制，不需要 |
| **tauri-driver** + **WebKitWebDriver**（Linux） | 全部 | `which tauri-driver` / `which WebKitWebDriver` | driver 起不来（`sudo apt install libwebkit2gtk-4.1-dev webkit2gtk-driver`，包名随发行版） |
| **host-runtime.lock.json** | 全部（packed/cargo 版本比对） | 文件在场且含 hostRuntime 段 | 无法校验 witVersion / mountContract ⇒ 显性报错，指引跑 `node scripts/ci/sync-host-lock.mjs` |

`scripts/e2e.mjs` 对以上都做**显性预检**（缺则打印修复指引并退出，不静默降级）。

```bash
node scripts/e2e.mjs --app bedcode                         # packed（默认）
node scripts/e2e.mjs --app bedcode --host-mode cargo       # 平台集成
node scripts/e2e.mjs --app bedcode --host ./host-desktop     # packed + 显式宿主产物目录
node scripts/e2e.mjs --app monitor --skip-build              # 复用 app 默认产物目录搬进 staging
```

---

## 3. 目录结构

```text
wasmnest-apps/e2e/
├─ wdio.conf.ts              WDIO 配置（驱动链 + 宿主二进制路径）
├─ tsconfig.json             TS 配置（e2e 作用域）
├─ harness/
│  ├─ driver.ts              DOM 原语：exists / visible / text / click / waitFor / waitGone …
│  ├─ shell.ts               宿主壳：goHome / openApp / homeAppCards
│  └─ expect.ts              带失败上下文的断言（jest 的 expect 不收第二个参数）
├─ pages/<slug>.ts           该 app 的页面对象（app 语义，不碰组件内部结构）
└─ specs/<slug>.spec.ts      该 app 的用例（一 app 一文件）
```

**分层纪律**：`specs/` 只写「用户做了什么 + 看得见什么」；`pages/` 放该 app 的语义动作；
`harness/` 放跨 app 通用原语。**用例里出现组件内部 class 名 = 抽象漏了**。

---

## 4. 怎么跑

```bash
# 单个 app（推荐：一次只装一个 app，主屏只有一张卡，断言不受干扰）
node scripts/e2e.mjs --app bedcode
node scripts/e2e.mjs --app ai-chatbox
node scripts/e2e.mjs --app bedcode
node scripts/e2e.mjs --app file-transfer
node scripts/e2e.mjs --app monitor

# 全量（依次跑每个 app：每个 app 单独一次 wdio，宿主单实例故不能并行）
node scripts/e2e.mjs

# 单条用例
node scripts/e2e.mjs --app bedcode --spec e2e/specs/bedcode.spec.ts

# 参数
--skip-build   复用现有产物（改过前端就别用）
--build-full   连 wasm 后端一起构建（默认只重建前端：E2E 关注交互层）
--isolate      用临时 XDG_DATA_HOME 隔离宿主持久状态
```

**退出码即结论**（0 = 全绿）。CI / 钩子可直接用它。

### 环境前置（一次性）

```bash
# 驱动（Linux）
cargo install tauri-driver
sudo apt install webkit2gtk-driver   # 提供 WebKitWebDriver

# 宿主 debug 二进制（wdio 插件只在 debug 注册）
cd <平台仓>/wasmnest-desktop && cargo build --manifest-path src-tauri/Cargo.toml
```

### 宿主运行时来源（`fetch-host` / lock）

`node scripts/fetch-host.mjs` 负责把**已发布的宿主资产**落到本地缓存（CONTRACT §4）：

- 版本：`WASMNEST_HOST_VERSION` → 仓根 `host-runtime.lock.json`。lock 由
  `node scripts/ci/sync-host-lock.mjs` 从平台 `release-manifest.json` 的 `hostRuntime` 段同步，
  `--check` 做漂移检查（CI 用）。
- 下载：默认 GitHub Releases（`WASMNEST_HOST_BASE_URL` 必须是 https）。**lock 的 sha256 是权威**；
  `.sha256` 边车存在时必须与 lock 一致；任何不匹配都中止且不落缓存。
- 离线 / 本机：`node scripts/fetch-host.mjs --from <host-desktop 目录|tar.gz>`；
  tar 没有 lock sha 时打印「未校验发布 sha」警告（不静默）。
- `--print` 只打印解析到的宿主可执行路径、不下载，可配合
  `WASMNEST_HOST_BIN=$(node scripts/fetch-host.mjs --print)`。
- 缓存布局：`<cache root>/<version>/<platform>-<arch>/`，完整性判据是 `.complete`
  （含 sha256 / 解包时间）；缓存根见 CONTRACT §3.3。

**tar 实现**：Node 内置 `zlib` + 自实现 ustar 读取器（与平台 `package-host.mjs` 的写入器对称），
**不依赖系统 `tar`**，跨平台行为一致。符号链接 / 硬链接 / 绝对路径 / `..` 条目一律拒绝
（防路径穿越）；解包走临时目录，校验通过后原子 rename，失败清理且不产生半套缓存。

---

## 5. 锚点约定（`data-testid`）

E2E 只认 `data-testid`。命名 = `<域>-<元素>`，kebab-case，**不带 app 前缀**：

| 形态 | 例子 | 出处 |
| --- | --- | --- |
| 面板根 | `panel-overview` / `panel-skills` / `sessions-view` | 各分区/视图根节点 |
| 标签/导航 | `hub-tab-skills` / `nav-sessions` | 分段栏、侧边栏项 |
| 动作 | `overview-detect` / `new-preset` / `lg-sources-toggle` | 按钮 |
| 状态字段 | `cli-badge-claude` / `chat-sidebar`（带 `data-collapsed`） | 状态徽章 / 带状态的面板 |

**宿主壳元素没有 testid**（宿主仓未加）：`harness/shell.ts` 只依赖 **ARIA 语义**
（`role="list"` / `role="listitem"` / `aria-label`）+ 可见文本，不依赖内部 class 名。

### 断言状态而非样式

优先断言 `aria-selected` / `aria-expanded` / `aria-pressed` / `data-*` 这类**语义状态**，
而不是 class 名或像素。class 变一下就碎；语义状态是产品契约的一部分。

---

## 6. 判据纪律（三条，缺一条套件就会随时间变脆）

### 6.1 不依赖机器状态

本机装没装 claude、有没有历史会话、网络通不通、宿主语言是什么——**都不该让用例变红**。

- 取**取值域**而不是具体值：`expectInSet(badge, labelSet('hub.card.installed'), …)`
- 取**交互前后状态翻转**而不是绝对状态：`点击后 aria-expanded 由 false 变 true`
- 机器相关的分支要**显式两分支都成立**：例如「未授权 → 入口禁用 + 横幅可见」「已授权 → 入口可展开表单」

### 6.2 文案断言跨语言

宿主语言随用户设置变（zh-CN / en）。**写死中文的断言在英文环境下必红**。
做法：期望值取 app i18n 各语言取值域的**并集**（`pages/<slug>.ts` 的 `labelSet(key)`）。

```ts
// e2e/pages/bedcode.ts（示意）
import en from '../../apps/bedcode/desktop/src/i18n/en'
import zhCN from '../../apps/bedcode/desktop/src/i18n/zh-CN'

export function labelSet(key: keyof typeof zhCN): string[] {
  const out: string[] = []
  for (const table of [zhCN, en] as Array<Record<string, unknown>>) {
    const value = table[key]
    if (typeof value === 'string') out.push(value)
  }
  return out
}
```

### 6.3 等状态，不 sleep

一律 `waitFor` / `waitGone`（等「目标出现 / 不可见」），不用固定 sleep 赌时序。

> **两个必须等的细节**（都踩过）：
> - **退场过渡**：Vue `<Transition>` 退场期间旧面板**仍在 DOM 里且仍有布局盒** → 判据要用
>   `waitGone`（等不可见），不能只看「切完了」。
> - **KeepAlive**：路由视图被缓存时旧视图**仍在 DOM 里**（只是不可见）→ 判据是
>   「不可见」而不是「不存在」。

---

## 7. 加一个新 app 的 E2E（推广流程）

1. **加锚点**：在被测交互元素上加 `data-testid`（先查该 app 是否已有 `data-testid` 约定）。
2. **写页面对象** `e2e/pages/<slug>.ts`：只放该 app 的语义动作（切分区、开面板、读状态）。
3. **写用例** `e2e/specs/<slug>.spec.ts`：一 app 一文件；`beforeEach` 从「主屏 → 点应用卡」
   重新进入 app（保证用例之间不互相污染）。
4. **跑**：`node scripts/e2e.mjs --app <slug>`。
5. **验有效性**：故意破坏一处锚点/行为，确认**对应用例会红**（套件抓不住回归 = 白测）。

> 新 app 的 `plugin.json` 的 `name` 就是主屏应用卡的显示名（`openApp()` 按它定位）。

---

## 8. 排障

| 现象 | 原因 / 处理 |
| --- | --- |
| `Tauri plugin not available` | **页面没加载**：宿主前端 dev server 没起（debug 二进制走 `devUrl`）。`scripts/e2e.mjs` 会自动起；手工跑 wdio 时先 `cd <平台仓>/wasmnest-desktop && pnpm run dev` |
| `宿主 debug 二进制不存在` | 构建：`<平台仓>/wasmnest-desktop && cargo build --manifest-path src-tauri/Cargo.toml`（release 产物**不能**跑 E2E） |
| `未找到 tauri-driver / WebKitWebDriver` | `cargo install tauri-driver` / `apt install webkit2gtk-driver` |
| `主屏找不到应用卡「X」` | app 产物没落进隔离目录（看运行器日志「产物已就位」）；或应用显示名 ≠ `plugin.json` 的 `name` |
| `app 构建失败：WASM file not found` | 共享 wasm target（`<appsRoot>/target/wasm-apps`）被 `cargo clean` 清掉了。**仅前端构建**（E2E 默认）会复用上一份产物（`--frontend-only` 的语义 =「只改前端，wasm 保持现状」）；要重建 wasm 用 `--build-full` |
| 用例全红但功能是好的 | 宿主没加载到最新前端：确认 dev server 指向平台仓 `src/`；或 app 产物没刷新（去掉 `--skip-build`） |
| 宿主启动即退出 / 端口占用 | 宿主是**单实例**资源（端口 + 应用数据目录）：关掉正在跑的 WasmNest |
| 第二个 app 的用例全超时 | 同上——宿主单实例。运行器已按「逐 app 一次 wdio」编排；手工跑 wdio 时不要在一个 run 里放多个 spec 文件 |

---

## 9. 已知边界

- **只能测 debug 构建**：release 产物不含 wdio 插件（平台仓有锁测试保证这点）。
- **外部依赖不覆盖**：真实对端（file-transfer）、真实 API key（ai-chatbox）不在范围内；
  相关用例只断言「界面层」的门控与状态翻转。
- **不测移动端**：§1–§9 的单端套件只覆盖桌面宿主；移动端由 §10 的双端套件承接。
- **宿主壳无 testid**：壳层交互只能靠 ARIA 语义定位；宿主若要更稳的锚点，需在**平台仓**
  补 `data-testid`（跨仓改动，需单独裁决）。
- **Windows / macOS**：驱动不同（WebKitWebDriver / 各平台 provider），本套件当前只在
  Linux 验证过。
- **wasm 产物可能是旧的**：E2E 默认只重建前端（wasm 复用上一份）。改了 Rust 后端要用
  `--build-full`，否则测的是旧后端 + 新前端。

---

## 10. 双端 E2E（真桌面宿主 + USB 真机）

### 10.1 为什么单独一套

单端套件（§1–§9）的盲区正是「**两台设备上的两个进程**」：配对、连接、会话控制、终端输出
都要跨进程 + 跨设备才成立。双端套件把这条链路补上，同时保持单端套件的日常可跑性——
真机是稀缺资源，双端用例**不进 per-commit**，用于 nightly / 发布前回归。

### 10.2 怎么跑

```bash
# 一次性前置
cargo install tauri-driver
sudo apt install webkit2gtk-driver          # Linux
# 手机：开发者选项 → USB 调试 → 授权；adb devices 必须是唯一 device

# debug APK（release 没有 WebView 调试套接字，CDP 连不上）
cd <平台仓>/wasmnest-mobile && pnpm run tauri:android:build:fast

# 跑（应用仓根）
node scripts/e2e-dual.mjs --app bedcode
# 或 pnpm e2e:dual --app bedcode

# 跑单条 / 指定设备 / 复用已装包
node scripts/e2e-dual.mjs --app bedcode --spec e2e/dual/bedcode-pairing.spec.ts
node scripts/e2e-dual.mjs --app bedcode --serial <serial> --skip-install
```

| 参数 | 作用 |
| --- | --- |
| `--apk <path>` | 指定 debug APK（缺省探测平台仓 `apk/{arm64,universal,x86_64}/debug/`） |
| `--skip-install` | 设备上已有最新 debug 包时跳过安装 |
| `--keep-data` | 不清移动端应用数据（保留配对记录，便于复现） |
| `--server-port <n>` | 桌面服务器端口（默认 8765；`adb reverse` 用同一端口） |
| `--no-isolate` | 不隔离桌面 `XDG_DATA_HOME`（默认隔离，端口与设置态可预期） |
| `--keep` | 保留失败现场与临时目录 |

### 10.3 它是怎么跑起来的

```text
scripts/e2e-dual.mjs（编排层）
 ├─ 预检：宿主 debug 二进制 / tauri-driver / WebKitWebDriver / adb 设备 / APK
 ├─ 构建 + 隔离插件目录（WASMNEST_PLUGINS_DIR，只装被测 app）
 ├─ adb reverse tcp:8765 tcp:8765   （设备 127.0.0.1 → 宿主 127.0.0.1）
 ├─ adb install -r -t <debug apk> → pm clear → force-stop
 └─ pnpm exec wdio run e2e/wdio.dual.conf.ts
      ├─ 桌面：WDIO → tauri-driver → WebKitWebDriver → debug 宿主（同 §2）
      └─ 手机：e2e/harness/mobile.ts
           ├─ adb：启动 / 截图 / logcat / input tap
           └─ CDP：adb forward tcp:19333 localabstract:webview_devtools_remote_<pid>
                → Runtime.evaluate（DOM 断言）/ Input.dispatchTouchEvent（真实触摸）
```

**为什么移动端用 CDP 而不是纯 adb 坐标点击**：坐标点击要经过 `CSS px × dpr + WebView
屏幕偏移` 换算，刘海 / 状态栏 / 缩放任何一处变化都会点到隔壁元素，失败还伪装成「功能坏」；
断言也只能靠截图 / OCR。CDP 给的是同一套 DOM 原语（与 `driver.ts` 同形），
`Input.dispatchTouchEvent` 仍然是真实触摸事件管线，但坐标由页面自己算。
需要验证**系统 InputManager** 路径时，`mobile.tapViaAdb(selector)` 保留 adb 点击，
坐标经 `uiautomator dump` 的 WebView 边界校准，校准失败直接报错（不静默退回 CDP）。
默认用例不走它；设 `WASMNEST_E2E_ADB_TAP=1` 时，配对码第一位改用
`adb shell input tap`，并以第一个码格回读校验点击真的生效（`--keep` 可保留现场）。

### 10.4 判据纪律（在 §6 之上追加两条）

1. **断言状态位，不断言文案**：设备语言可能是 zh-CN / en。移动端连接态读
   `[data-testid="mobile-connection-status"][data-connected="true"]`，桌面配对码消失用
   `waitGone('pairing-code')`，不匹配「已连接 / Connected」。
2. **端子画布不能当文本读**：xterm 渲染在 canvas，DOM 里没有终端输出。终端类用例的
   oracle 用**桌面侧副作用**（手机发 `echo MARKER > /tmp/x`，宿主侧校验文件）或
   暴露 xterm buffer 句柄，不用截图 / OCR。

### 10.5 锚点约定

- 桌面：沿用 `data-testid`（§5）。本次为双端链路补了 `pairing-code` /
  `pairing-tab-<key>` / `paired-device-row`。
- 移动端：同样只认 `data-testid`，命名带 `mobile-` 前缀避免与桌面同名混淆
  （本次补：`mobile-bedcode-root` / `mobile-manual-connect` / `mobile-manual-input` /
  `mobile-manual-confirm` / `mobile-pairing-dialog` / `mobile-pairing-key-<d>` /
  `mobile-pairing-submit` / `mobile-connection-status`）。
- **宿主壳没有锚点**（平台仓未加）：移动端主屏应用卡用 `aria-label` 前缀（= 应用名，
  与语言无关），桌面端壳用 ARIA 语义（§5）。

### 10.6 加一条双端用例

1. 在 `e2e/dual/` 建 `<slug>-<场景>.spec.ts`，用 `MobileApp.launch()` + `../harness/*`；
2. 只写「用户做了什么 + 两端各看到什么」；页面语义动作抽到 `harness/mobile.ts` 或新 driver；
3. 交互面新增锚点时同步补（锚点改名 = 用例红，需一起改）；
4. 先跑单条确认能红：故意破坏一处锚点，确认对应用例真的失败（抓不住回归 = 白测）。

### 10.7 已知边界

- **只测 debug 产物**：release 既没有 wdio 插件，也没有 Android WebView 调试套接字。
- **扫码不自动化**：相机对着屏幕在 CI 不可控；双端用例走产品已有的「手动地址 + 配对码」。
- **mDNS 发现不可用**：组播不过 adb；需要覆盖发现路径时必须让手机与桌面同网段（另一套环境）。
- **单设备串行**：桌面宿主单实例 + 真机一台，`maxInstances = 1`，不要并行。
- **APK 陈旧**：编排器会对比 `apps/<slug>/mobile/src` 的 mtime 并告警；改了移动端必须重建 APK。
- **失败现场**：`e2e/artifacts/dual-<timestamp>/`（手机截图 + logcat）；桌面失败仍由 wdio 输出。

### 10.8 排障补充

| 现象 | 原因 / 处理 |
| --- | --- |
| `没有可用的真机` | USB 调试未授权 / 数据线只供电；`adb devices` 状态必须是 `device` |
| `没找到 WebView 调试套接字` | 装的是 release 包；用 `tauri:android:build:fast` 的 debug APK |
| 手机连不上桌面（一直「连接中」） | `adb reverse` 未生效（重插 USB 会清空）；重跑编排器 |
| `端口 8765 已被占用` | 本机正在跑 WasmNest；关掉或 `--server-port` 换端口（需与宿主设置一致） |
| 用例在手机壳主屏超时 | 应用清单未加载（冷启动扫描慢）/ APK 内没打进被测 app；看 `dumpLogcat` 产物 |
| **输入框填了值，点「确认」却像没反应**（面板反而关了） | **软键盘挡住了按钮**：输入法是浮在 WebView 之上的独立原生窗口，覆盖处的触摸被 IME 吃掉。`harness/mobile.ts` 的 `type()` 已在输入后自动 `dismissIme()`（keyevent 111 / ESC）；自己写用例时若绕过 `type()`，点按钮前先 `await mobile.dismissIme()` |

### 10.9 CI 姿态

- **不进 per-commit**：真机是单实例稀缺资源，双端套件与单端 E2E / 单测分开跑。
- 建议独立 workflow：`on: schedule`（nightly）+ `workflow_dispatch`，`runs-on` 选带真机的
  self-hosted runner；**串行**（`maxInstances: 1`，不要矩阵并行），失败上传
  `e2e/artifacts/dual-*`（手机截图 + logcat）。
- 未接入 CI 前，以本地手动执行 `node scripts/e2e-dual.mjs --app bedcode` 为准；
  不要在 per-commit CI 里加「无设备就 skip」的分支——空跑绿灯比不跑更危险。

---

## 11. 真机单端 E2E（真机 + 移动宿主）

### 11.1 为什么单独一套

移动端应用此前只有两条验证面：vitest 单测（逻辑）与 SDK dev-shell（界面）。
dev-shell 是**壳的 mock 形态**——后端通道全是浏览器实现（权限全放行、WASM 不跑、
命令只跑前端 handler）。于是「应用在**真宿主**里能不能跑起来」（真 wasm 组件装载、
真权限门、真壳路由、真宿主路由跳转）没有任何自动化覆盖，只能靠人肉在真机上看。

§10 的双端套件覆盖的是「两端同时在场」的链路；本 lane **只驱动手机这一端**，但宿主
是真的（真 APK 内置真宿主 + 真 wasm + 真权限门）。桌面在场与否不影响手机侧断言，
所以不把桌面宿主拉进来——省掉「构建 app 产物 / 隔离插件目录 / 起 dev server」三件重活，
也避免「设备没接好」与「桌面没起好」两种失败混在一起。

### 11.2 怎么跑

```bash
# 一次性前置
# 真机：开发者选项 → USB 调试 → 授权；adb devices 必须是唯一 device
# debug APK（release 没有 WebView 调试套接字，CDP 连不上）
cd <平台仓>/wasmnest-mobile && pnpm run tauri:android:build:fast

# 跑（应用仓根）
node scripts/e2e-mobile.mjs --app file-transfer
# 或 pnpm e2e:mobile --app file-transfer

# 跑单条 / 指定设备 / 复用已装包
node scripts/e2e-mobile.mjs --app file-transfer --spec e2e/mobile/file-transfer.spec.ts
node scripts/e2e-mobile.mjs --app file-transfer --serial <serial> --skip-install
```

| 参数 | 作用 |
| --- | --- |
| `--apk <path>` | 指定 debug APK（缺省探测平台仓 `apk/{arm64,universal,x86_64}/debug/`） |
| `--serial <serial>` | 指定设备（缺省 ANDROID_SERIAL / 唯一在线设备） |
| `--skip-install` | 设备上已有最新 debug 包时跳过安装 |
| `--keep-data` | 不清移动端应用数据（保留配对记录 / 历史，便于复现） |
| `--spec <path>` | 透传 mocha `--spec`（跑单条用例） |
| `--keep` | 保留失败现场与临时目录 |

### 11.3 它是怎么跑起来的

```text
scripts/e2e-mobile.mjs（编排层）
  ├─ 预检：adb 设备（唯一 online）/ debug APK 存在 / APK 新鲜度告警
  ├─ adb install -r -t <debug apk> → pm clear → force-stop
  └─ pnpm exec mocha --require tsx e2e/mobile/<slug>-*.spec.ts
       └─ e2e/harness/mobile.ts
            ├─ adb：启动 / 截图 / logcat
            └─ CDP：adb forward tcp:19333 localabstract:webview_devtools_remote_<pid>
                 → Runtime.evaluate（DOM 断言）/ Input.dispatchTouchEvent（真实触摸）
```

**为什么用 mocha 而不是 wdio**：wdio 强制要求至少一个浏览器能力，缺能力直接
「Missing capabilities, exiting with failure」；而本 lane 没有 WebDriver 会话——
手机侧全程由 CDP 驱动。桌面 lane 仍走 wdio（要驱动桌面 webview）。两条 lane 的用例
风格一致（mocha 的 `describe` / `it`），断言原语按通道分两份：
`harness/expect.ts`（webdriverio，桌面）/ `harness/expect-node.ts`（Node assert，真机）。

### 11.4 判据纪律

在 §6 之上追加两条：

1. **断状态位，不断文案**：`data-online` / `aria-pressed` / `disabled`；设备语言可能是
   zh-CN / en。
2. **断言要有牙**：file-transfer 移动端的 `devMock.ts` 给 mock 壳播了「已连接的活跃
   对端」（小米 14 Pro），真宿主**忽略 devMock** → 真机必然离线。故
   `mobile-ft-peer-status[data-online="false"]` + 上传按钮 `disabled` 这两条，
   对 mock 壳是红的、对真机是绿的——它们同时证明了「跑的是真宿主真 wasm，不是 mock 壳」。

### 11.5 加一条真机单端用例

1. 在 `e2e/mobile/` 建 `<slug>-<场景>.spec.ts`；
2. 只写「用户做了什么 + 看得见的状态位」；页面语义动作抽到 `harness/mobile.ts`；
3. 交互面新增锚点时同步补（锚点改名 = 用例红）：移动端统一 `mobile-` 前缀；
4. 先跑单条确认能红：故意破坏一处锚点，确认对应用例真的失败（抓不住回归 = 白测）。

### 11.6 已知边界

- **只测 debug 产物**：release 不开 WebView 调试套接字，CDP 连不上。
- **APK 陈旧**：编排器对比 `apps/<slug>/mobile/src` 的 mtime 并告警；改了移动端必须重建 APK。
- **应用代码取自 APK**：真机上的应用 = 打进 APK 的那一份；改代码 → 重建 APK → 重装。
- **单设备串行**：真机一台，别并行。
- **失败现场**：`e2e/artifacts/mobile-<timestamp>/`（截图 + logcat）。
- **手机侧没有前端日志**：release 构建里前端 logger 是空实现（`frontendLogger.ts`：生产构建
  零开销），所以真机上**看不到 app 的 console 输出**（logcat 只有宿主 Rust 日志，CDP 也收不到
  `consoleAPICalled`）。排障靠「读状态位 + 截图」；要看前端日志请用 dev-shell。

### 11.7 CI 姿态

- 与 §10.9 同：真机是稀缺资源，不进 per-commit；nightly / 手动跑。
- 未接入 CI 前，以本地手动执行 `node scripts/e2e-mobile.mjs --app file-transfer` 为准；
  不要在 per-commit CI 里加「无设备就 skip」的分支——空跑绿灯比不跑更危险。

# wasmnest-apps

**The WasmNest application repo — the single home of business semantics.**

WasmNest's desktop and Android hosts provide only mechanisms and security gates. Product capabilities — sessions, terminals, file transfer, AI, agent management — all live here as **wasm apps**, built independently and loaded by the host under explicit permissions. Product apps (`apps/`) and service-type wasm (`servers/`: auth center, runtime monitor, network config and other internal services) coexist in this repo under the same project shape, covered by the same project enumeration and build orchestration.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-Component-654FF0?logo=webassembly&logoColor=white)](https://component-model.bytecodealliance.org)

English | [简体中文](README.md)

## Apps (apps/)

| App (directory) | Plugin id | Ends | Capability |
| --- | --- | --- | --- |
| [BedCode](apps/bedcode/README.md) (`bedcode`) | `com.wasmnest.bedcode` | desktop + mobile | Desktop is the terminal session center (pairing/trust, session orchestration, task queue, agent integration); mobile is a remote terminal controller |
| [AI Chatbox](apps/ai-chatbox/README.md) (`ai-chatbox`) | `com.wasmnest.ai-chatbox` | desktop + mobile | Multi-provider AI chat: streaming output, multi-session management, JSONL conversation logs |
| [File Transfer](apps/file-transfer/README.md) (`file-transfer`) | `com.wasmnest.file-transfer` | desktop + mobile | LAN peer discovery, bidirectional transfer, resumable downloads and shared directories; one Rust artifact for both ends |
| [Lanbitou](apps/lanbitou/CHANGELOG.md) (`lanbitou`) | `com.wasmnest.lanbitou` | desktop | Lanbitou: a lightweight Markdown notepad with plain-text editing + live preview, auto-save, archiving and clipboard integration |

> Plugin ids match directory slugs (`com.wasmnest.<slug>`): `bedcode` maps to `com.wasmnest.bedcode` (renamed from the legacy id `com.wasmnest.terminal-session` on 2026-10-25). New apps always use `com.wasmnest.<slug>`.

## Services (servers/)

Service-type wasm: shared foundational capabilities for product apps, with assembly roles L1 (base service) / L2 (internal business) (`type: internal-business` in `plugin.json`). Project structure is fully isomorphic to apps.

| Service (directory) | Plugin id | Ends | Capability |
| --- | --- | --- | --- |
| [Auth Center](servers/auth-center/CHANGELOG.md) (`auth-center`) | `com.wasmnest.auth-center` | desktop | Auth center: the sole fail-closed arbiter for local inbound connections — pairing codes / QR / trust / first-connect confirmation / auth policies / biometric credentials, plus an auth record store and inter-app API surface consumed by BedCode, file-transfer, etc. |
| [Monitor](servers/monitor/CHANGELOG.md) (`monitor`) | `com.wasmnest.monitor` | desktop + mobile | Runtime monitoring: read-only view of runtime metrics for all loaded wasm apps (memory / calls / fuel / traps / authorization / backpressure) plus platform overview and threshold alerts |
| [Net Config](servers/net-config/CHANGELOG.md) (`net-config`) | `com.wasmnest.net-config` | desktop | Network config center: the cross-app single source of truth for tunneling config — relay address import, external-network registry, deployment text generation and address validation |

## App Shapes on Both Ends

The frontend shapes differ between desktop and mobile and must not be mixed (`servers/` projects follow the same):

| | Desktop | Mobile |
| --- | --- | --- |
| Entry | `src/entry.ts` → `mountApp(root, env)`; optional `mountPreview(root, env)` | `src/index.ts` → `activate(context)` / `deactivate()` |
| Build | Independent mount bundle, **all dependencies included, no externals** | SDK `wasmnestPlugin()`; `vue` / `vue-i18n` / `pinia` externalized to host globals |
| Host relation | Runtime dynamic `import` of a single-file bundle | Runtime registration into the host shell (`UIRegistry` / surfaces) |
| Preview | Real desktop host `tauri:dev` (platform repo) | SDK dev-shell (HMR) |
| Rust | Usually `wasm32-wasip3` emitting a Component directly | `wasm32-unknown-unknown` + platform componentizer |

**File Transfer is a dual-end single artifact**: `apps/file-transfer/{desktop,mobile}` contain only frontends; all Rust lives at app level under `apps/file-transfer/rust/`:

- `rust/core/`: shared business core (port traits + pure logic, zero SDK dependencies, native-testable).
- `rust/plugin/`: one crate shared by both ends; both build chains point at it.

## Repository Layout

```text
wasmnest-apps/
├─ apps/<slug>/desktop/            # Desktop app project (mount bundle)
│  ├─ plugin.json                  # Manifest: id / permissions / contributes / rustLibrary
│  ├─ src/entry.ts                 # mountApp + optional mountPreview
│  ├─ src/appContext.ts            # AppMountEnv → PluginContext adapter
│  ├─ src/preview/                 # Read-only task-card preview (optional)
│  ├─ rust/                        # WASM backend (file-transfer is the exception)
│  └─ scripts/build.js             # vite → cargo → copy into host resources → inject wasmHash
├─ apps/<slug>/mobile/             # Mobile app project (host shell runtime surface)
│  ├─ plugin.json
│  ├─ src/index.ts                 # activate / deactivate
│  └─ rust/ (or sharedRustManifest)
├─ servers/<slug>/{desktop,mobile}/  # Service-type wasm projects (L1 / L2, same shape)
├─ apps/file-transfer/rust/{core,plugin}/
├─ e2e/                            # wdio E2E: harness / pages / specs / dual / mobile
├─ scripts/
│  ├─ run-apps.mjs                 # Run one script across all projects serially (apps + servers)
│  ├─ package-plugins.mjs          # Build + package each plugin as a zip
│  ├─ e2e.mjs / e2e-dual.mjs / e2e-mobile.mjs   # Desktop / dual-end / single-end-on-device E2E runners
│  ├─ host-runtime.mjs             # Desktop host runtime resolver (explicit → host:pack → download cache)
│  ├─ fetch-host.mjs               # Host asset download / sha256 verification / extraction
│  ├─ install-runtime.mjs          # L2 shared runtime crate build / install
│  ├─ link-platform-sdk.mjs / unlink-platform-sdk.mjs  # Switch SDK deps to local platform source (a pair)
│  ├─ platform-paths.mjs           # Projects → platform resolver (WASMNEST_PLATFORM_ROOT)
│  ├─ plugin-wasm-config.mjs       # wasip3 target / pinned nightly / shared target dir
│  ├─ qr-decode-bench.mjs          # QR decoding benchmark
│  ├─ replace-console.mjs          # console.* → unified logger
│  ├─ ci/                          # CI assembly: discover / build-app / app-info / set-app-version
│  └─ lib/projects.mjs             # Single source of truth for project enumeration (apps + servers)
├─ docs/                           # CODE-MAP / FRONTEND / BACKEND / CI / E2E / wasm-app-dev / adr / agents / design / verification
├─ .github/workflows/              # CI: ci.yml + app-build / app-release / app-build-reusable
├─ eslint.config.js                # Frontend resource-access red lines
├─ GLOSSARY.md                     # Domain glossary
├─ host-runtime.lock.json          # Host runtime version lock
└─ .cargo/config.toml              # Shared target/wasm-apps + jobs=4 + sccache
```

Each project (`apps/` and `servers/`) keeps its own pnpm workspace (`pnpm-lock.yaml` and `pnpm-workspace.yaml`); they are not merged. The root `package.json` only orchestrates. The single source of truth for project enumeration is `scripts/lib/projects.mjs` — adding an app or service requires no script changes.

## Quick Start

### Prerequisites

- The four repos in a sibling layout; this repo reads platform paths from `../wasmnest` by default. The WIT contract source lives in `../wasmnest-lib`, and apps consume it only through generated platform SDK artifacts.
- Node.js ≥ 22 and pnpm `12.2.1`.
- Rust stable + the `wasm32-wasip3` / `wasm32-unknown-unknown` targets; `sccache` is required (`.cargo/config.toml` forces `rustc-wrapper`).
- Running in a real desktop host requires the platform repo's desktop host.
- E2E prerequisites: desktop E2E needs `tauri-driver` + `WebKitWebDriver`; dual-end / single-end-on-device E2E needs adb + a debug APK (see [`docs/E2E.md`](docs/E2E.md)).
- The SDK defaults to released artifacts locally; to work directly against the platform repo source, use `pnpm run link:platform` (workspace state — always `pnpm run unlink:platform` to restore before committing).

### Install Dependencies

```bash
# App repo root dependencies (eslint / prettier / husky)
pnpm install

# Every project (apps + servers, both ends) is installed independently
for app in apps/*/desktop apps/*/mobile servers/*/desktop servers/*/mobile; do
  [ -f "$app/package.json" ] && (cd "$app" && pnpm install)
done
```

### Test and Build

```bash
# Whole repo, serially per project (apps + servers)
pnpm run test:run
pnpm run build
pnpm run lint
pnpm run test:scripts        # scripts/ own unit tests (node --test)

# One project (BedCode desktop in this example)
cd apps/bedcode/desktop
pnpm run test:run
pnpm run build
```

A desktop project's `build` writes artifacts directly into the platform host at `src-tauri/resources/plugins/desktop/<id>/`. A mobile project's `build` only produces its own `dist/` by default; writing into host resources is the platform repo's mobile build responsibility (`file-transfer/mobile` is the exception: its `build` goes straight through the platform wrapper script).

### E2E (Automated Testing in a Real Host)

Three runners bring up "host + project under test + driver chain" with one command and clean up afterwards:

```bash
# Desktop: mount the real wasm app in a real host, click the UI and assert (packed host mode by default)
node scripts/e2e.mjs --app bedcode

# Dual-end: desktop host + USB device both present (pairing / cross-end flows)
node scripts/e2e-dual.mjs --app bedcode

# Single-end on device: real device + real mobile host, desktop absent
node scripts/e2e-mobile.mjs --app file-transfer
```

Writing, judgment discipline and troubleshooting: [`docs/E2E.md`](docs/E2E.md). Functional acceptance templates: [`docs/verification/`](docs/verification/README.md) (the two do not substitute for each other).

### Debug in a Real Host

> The commands below start from the apps repo root.

```bash
# Platform repo: build a distributable host runtime (no platform source dependency)
cd ../wasmnest/wasmnest-desktop
pnpm run host:pack

# Apps repo: load this project's artifact in a real host (every desktop project has dev:host)
cd ../../wasmnest-apps/apps/bedcode/desktop
pnpm run dev:host
```

Other desktop projects needing a real host likewise run `pnpm run dev:host` inside their own project. Mobile projects can use the SDK dev-shell first: `pnpm run dev`.

## Common Commands

### App Repo Root

| Command | Purpose |
| --- | --- |
| `pnpm run test:run` | Run `test:run` per project serially (apps + servers; missing scripts print skip, never silently ignored) |
| `pnpm run build` | Build every project serially |
| `pnpm run test:scripts` | `scripts/` own unit tests (node --test) |
| `pnpm run lint` | Root eslint (zero errors) |
| `pnpm run format` | Prettier over `apps/**/src/**` and `servers/**/src/**` |
| `pnpm run e2e` | Desktop E2E (`node scripts/e2e.mjs`; see `docs/E2E.md`) |
| `pnpm run e2e:dual` / `e2e:mobile` | Dual-end / single-end-on-device E2E (needs a real device; see `docs/E2E.md` §10–§11) |
| `pnpm run link:platform` / `unlink:platform` | Switch SDK deps to local platform source / restore exactly (workspace state, never commit) |
| `pnpm run bench:qr` | QR decoding benchmark |
| `node scripts/run-apps.mjs <script> [--only=<group>/<slug>[/<end>]]` | Run one script across all projects, filterable by project / end (same entry as the CI matrix) |
| `node scripts/package-plugins.mjs --list` | Print the resolved plugin list |
| `node scripts/package-plugins.mjs --target <desktop\|mobile\|all> [--plugin <id>]` | Build, collect artifacts and zip each plugin |

### One Project

| Command | Purpose | Exception |
| --- | --- | --- |
| `pnpm run test:run` | That project's vitest | — |
| `pnpm run build` | Desktop = `node scripts/build.js`; mobile = SDK CLI / platform wrapper | — |
| `pnpm run build:frontend` / `build:rust` | Desktop partial builds (`ai-chatbox/desktop` also has `build:go` / `build:both`) | Mobile has no partial scripts |
| `pnpm run dev` | Desktop = watch build; mobile = SDK dev-shell | `bedcode/desktop` has no `dev` |
| `pnpm run dev:host` | Start a real desktop host inside the project | Every desktop project has it |
| `cargo test --manifest-path rust/Cargo.toml` | Native Rust tests for that project | For `file-transfer`, use the `rust/core` / `rust/plugin` manifests; `bedcode/desktop` also has `pnpm run test:rust` |

> **Never run `pnpm run test`** (vitest watch never exits); always use `test:run`.

## Cross-repo Boundaries

- Apps depend only on platform SDK packages (`@binblink/wasmnest-plugin-sdk-desktop` / `-mobile`) and **never import host source**. The host frontend likewise never imports app source; it loads artifacts at runtime.
- WIT / ABI sources are not here: the core WIT lives in the capability repo, end composition and SDK artifacts in the platform repo. Contract changes do not happen in this repo.
- Each app owns its business sources of truth (private database / KV / registries); they are not pushed into the host kernel.
- Frontend code must not touch network / file / navigation primitives directly; resource access goes through the SDK and host permission gates.
- Adding, renaming or retiring an app or service also requires syncing the platform repo's registries, route table, lock lists and `release-manifest.json` (`servers/` entries carry `group: 'servers'`; full checklist in [`AGENTS.md`](AGENTS.md) §6).
- Platform locks read this repo's source: `hostAppBoundaryLock` (byte-validates the six desktop `entry.ts` files, including `servers/auth-center`) and `tailwindContentCoverage` (the old i18n drift lock was retired on 2026-10-27). Read the lock before changing the corresponding surface.

## Documentation

| Need | Entry point |
| --- | --- |
| Decision criteria, hard constraints, commands and verification | [`AGENTS.md`](AGENTS.md) |
| Structure / project list / artifact flow | [`docs/CODE-MAP.md`](docs/CODE-MAP.md) |
| Frontend conventions (both ends / mount contract / preview / i18n) | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| Rust backend conventions (crates / commands / permissions / build) | [`docs/BACKEND.md`](docs/BACKEND.md) |
| Wasm app development guide (desktop / mobile / manifest / red lines) | [`docs/wasm-app-dev/`](docs/wasm-app-dev/) |
| CI (build, per-project releases, tag discipline) | [`docs/CI.md`](docs/CI.md) |
| E2E (three runners / anchors / judgment discipline) | [`docs/E2E.md`](docs/E2E.md) |
| Per-project functional acceptance templates and reporting | [`docs/verification/README.md`](docs/verification/README.md) |
| Architecture decision records (ADR) | [`docs/adr/`](docs/adr/) |
| Agent collaboration conventions (domain / issues / triage) | [`docs/agents/`](docs/agents/) |
| Design documents (NAT traversal, etc.) | [`docs/design/`](docs/design/) |
| Domain glossary | [`GLOSSARY.md`](GLOSSARY.md) |
| Platform repo (hosts / SDKs / release-manifest) | [github.com/7ZAI/wasmnest](https://github.com/7ZAI/wasmnest) |
| Capability repo (engines / WIT sources) | [github.com/7ZAI/wasmnest-lib](https://github.com/7ZAI/wasmnest-lib) |
| Real cross-end integration tests | [github.com/7ZAI/wasmnest-test](https://github.com/7ZAI/wasmnest-test) |
| Shared conventions (git / comments / testing / versioning / issues) | Platform repo `docs/public/` |

## Development and Contributing

1. Read [`AGENTS.md`](AGENTS.md) and the platform repo's [`docs/public/`](https://github.com/7ZAI/wasmnest/tree/main/docs/public) first; business semantics stay in apps and are not pushed into the host.
2. Commit in small steps with the project slug as the commit scope; commit source only, never artifacts.
3. Frontend changes run that project's `test:run`; Rust changes run that crate's `cargo test`. Changes touching macros, inter-app calls or build targets must also run a wasm-target build; interaction-surface changes additionally run that project's E2E (renaming an anchor turns cases red — change them together).
4. CI is GitHub Actions (`.github/workflows/`, see [`docs/CI.md`](docs/CI.md)): verification means actually running local commands, the platform-side locks and CI — the three do not substitute for each other. Report what ran, what did not, and the risk.
5. Cross-session work is tracked in [GitHub Issues](https://github.com/7ZAI/wasmnest-apps/issues).

## Project Status

Early development, version line `0.0.1`. **Each project has its own version and release**: pushing a `<slug>-v<X.Y.Z>` tag triggers that project's CI build and release (version discipline in [`docs/CI.md`](docs/CI.md) §2); the whole-repo tag `apps-vX.Y.Z` is the version the platform repo's `release-manifest.json` assembles this repo from. Untagged local changes never enter a release assembly.

## License

[MIT](LICENSE) © 2026 7ZAI

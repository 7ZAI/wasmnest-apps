# wasmnest-apps

**The WasmNest application repo — the single home of business semantics.**

WasmNest's desktop and Android hosts provide only mechanisms and security gates. Product capabilities — sessions, terminals, file transfer, AI, agent management — all live here as **wasm apps**, built independently and loaded by the host under explicit permissions.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-Component-654FF0?logo=webassembly&logoColor=white)](https://component-model.bytecodealliance.org)

English | [简体中文](README.md)

## Apps

| App (directory) | Plugin id | Ends | Capability |
| --- | --- | --- | --- |
| [BedCode](apps/bedcode/README.md) (`bedcode`) | `com.wasmnest.terminal-session` | desktop + mobile | Desktop is the terminal session center (pairing/trust, session orchestration, task queue, agent integration); mobile is a remote terminal controller |
| [AI Chatbox](apps/ai-chatbox/README.md) (`ai-chatbox`) | `com.wasmnest.ai-chatbox` | desktop + mobile | Multi-provider AI chat: streaming output, multi-session management, JSONL conversation logs |
| [File Transfer](apps/file-transfer/README.md) (`file-transfer`) | `com.wasmnest.file-transfer` | desktop + mobile | LAN peer discovery, bidirectional transfer, resumable downloads and shared directories; one Rust artifact for both ends |
| [Agent Hub](apps/agent-hub/README.md) (`agent-hub`) | `com.wasmnest.agent-hub` | desktop | Agent CLI management: install/uninstall, Skills, provider configuration, usage stats |

> Directory slugs and plugin ids do not have to match: `bedcode` maps to `com.wasmnest.terminal-session`. New apps always use `com.wasmnest.<slug>`.

## App Shapes on Both Ends

The frontend shapes differ between desktop and mobile and must not be mixed:

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
├─ apps/file-transfer/rust/{core,plugin}/
├─ scripts/
│  ├─ run-apps.mjs                 # Run one script across apps serially
│  ├─ package-plugins.mjs          # Build + package each plugin as a zip
│  ├─ platform-paths.mjs           # Apps → platform resolver (WASMNEST_PLATFORM_ROOT)
│  ├─ plugin-wasm-config.mjs       # wasip3 target / pinned nightly / shared target dir
│  └─ replace-console.mjs          # console.* → unified logger
├─ docs/                           # CODE-MAP / FRONTEND / BACKEND
├─ eslint.config.js                # Frontend resource-access red lines
└─ .cargo/config.toml              # Shared target/wasm-apps + jobs=4 + sccache
```

Each app keeps its own pnpm workspace (`pnpm-lock.yaml` and `pnpm-workspace.yaml`); they are not merged. The root `package.json` only orchestrates.

## Quick Start

### Prerequisites

- The four repos in a sibling layout; this repo reads platform paths from `../wasmnest` by default. The WIT contract source lives in `../wasmnest-lib`, and apps consume it only through generated platform SDK artifacts.
- Node.js ≥ 22 and pnpm `12.2.1`.
- Rust stable + the `wasm32-wasip3` / `wasm32-unknown-unknown` targets; `sccache` is required (`.cargo/config.toml` forces `rustc-wrapper`).
- Running in a real desktop host requires the platform repo's desktop host; `file-transfer`'s `dev:host` also requires `pnpm run host:pack` in the platform repo.

### Install Dependencies

```bash
# App repo root dependencies (eslint / prettier / husky)
pnpm install

# Every app project is installed independently
for app in apps/*/desktop apps/*/mobile; do
  [ -f "$app/package.json" ] && (cd "$app" && pnpm install)
done
```

### Test and Build

```bash
# Whole repo, serially per app
pnpm run test:run
pnpm run build
pnpm run lint

# One app (BedCode desktop in this example)
cd apps/bedcode/desktop
pnpm run test:run
pnpm run build
```

A desktop app's `build` writes artifacts directly into the platform host at `src-tauri/resources/plugins/desktop/<id>/`. A mobile app's `build` only produces its own `dist/` by default; writing into host resources is the platform repo's mobile build responsibility (`file-transfer/mobile` is the exception: its `build` goes straight through the platform wrapper script).

### Debug in a Real Host

> The commands below start from the apps repo root.

```bash
# Platform repo: build a distributable host runtime (no platform source dependency)
cd ../wasmnest/wasmnest-desktop
pnpm run host:pack

# Apps repo: load this app's artifact in a real host (file-transfer/desktop only)
cd ../../wasmnest-apps/apps/file-transfer/desktop
pnpm run dev:host
```

For other desktop apps, run `pnpm run tauri:dev` in the platform repo. Mobile apps can use the SDK dev-shell first: `pnpm run dev`.

## Common Commands

### App Repo Root

| Command | Purpose |
| --- | --- |
| `pnpm run test:run` | Run `test:run` per app serially (missing scripts print skip, never silently ignored) |
| `pnpm run build` | Build every app serially |
| `pnpm run lint` | Root eslint (zero errors) |
| `pnpm run format` | Prettier over `apps/**/src/**` |
| `node scripts/package-plugins.mjs --list` | Print the resolved plugin list |
| `node scripts/package-plugins.mjs --target <desktop\|mobile\|all> [--plugin <id>]` | Build, collect artifacts and zip each plugin |

### One App

| Command | Purpose | Exception |
| --- | --- | --- |
| `pnpm run test:run` | That app's vitest | `file-transfer/mobile` has no such script |
| `pnpm run build` | Desktop = `node scripts/build.js`; mobile = SDK CLI / platform wrapper | — |
| `pnpm run build:frontend` / `build:rust` | Desktop partial builds | Mobile has no partial scripts |
| `pnpm run dev` | Desktop = watch build; mobile = SDK dev-shell | `bedcode/desktop` has no `dev` |
| `pnpm run dev:host` | Start a real desktop host inside the app project | `file-transfer/desktop` only |
| `cargo test --manifest-path rust/Cargo.toml` | Native Rust tests for that app | For `file-transfer`, use the `rust/core` / `rust/plugin` manifests; `bedcode/desktop` also has `pnpm run test:rust` |

> **Never run `pnpm run test`** (vitest watch never exits); always use `test:run`.

## Cross-repo Boundaries

- Apps depend only on platform SDK packages (`@binblink/wasmnest-plugin-sdk-desktop` / `-mobile`) and **never import host source**. The host frontend likewise never imports app source; it loads artifacts at runtime.
- WIT / ABI sources are not here: the core WIT lives in the capability repo, end composition and SDK artifacts in the platform repo. Contract changes do not happen in this repo.
- Each app owns its business sources of truth (private database / KV / registries); they are not pushed into the host kernel.
- Frontend code must not touch network / file / navigation primitives directly; resource access goes through the SDK and host permission gates.
- Adding, renaming or retiring an app also requires syncing the platform repo's registries, route table, lock lists and `release-manifest.json` (full checklist in [`AGENTS.md`](AGENTS.md) §6).
- Platform locks read this repo's source: `hostAppBoundaryLock` (byte-validates the four desktop `entry.ts` files), `i18nDriftLock` (host ↔ BedCode desktop i18n byte equality) and `tailwindContentCoverage`. Read the lock before changing the corresponding surface.

## Documentation

| Need | Entry point |
| --- | --- |
| Decision criteria, hard constraints, commands and verification | [`AGENTS.md`](AGENTS.md) |
| Structure / app list / artifact flow | [`docs/CODE-MAP.md`](docs/CODE-MAP.md) |
| Frontend conventions (both ends / mount contract / preview / i18n) | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| Rust backend conventions (crates / commands / permissions / build) | [`docs/BACKEND.md`](docs/BACKEND.md) |
| Platform repo (hosts / SDKs / release-manifest) | [github.com/7ZAI/wasmnest](https://github.com/7ZAI/wasmnest) |
| Capability repo (engines / WIT sources) | [github.com/7ZAI/wasmnest-lib](https://github.com/7ZAI/wasmnest-lib) |
| Real cross-end integration tests | [github.com/7ZAI/wasmnest-test](https://github.com/7ZAI/wasmnest-test) |
| Shared conventions (git / comments / testing / versioning / issues) | Platform repo `docs/public/` |

## Development and Contributing

1. Read [`AGENTS.md`](AGENTS.md) and the platform repo's [`docs/public/`](https://github.com/7ZAI/wasmnest/tree/main/docs/public) first; business semantics stay in apps and are not pushed into the host.
2. Commit in small steps with the app slug as the commit scope; commit source only, never artifacts.
3. Frontend changes run that app's `test:run`; Rust changes run that crate's `cargo test`. Changes touching macros, inter-app calls or build targets must also run a wasm-target build.
4. There is no CI: verification means actually running local commands plus the platform-side locks. Report what ran, what did not, and the risk.
5. Cross-session work is tracked in [GitHub Issues](https://github.com/7ZAI/wasmnest-apps/issues).

## Project Status

Early development, version line `0.0.1`. This repo is tagged independently (`apps-vX.Y.Z`) and consumed by the platform repo's `release-manifest.json` via exact tags; untagged local changes never enter a release assembly.

## License

[MIT](LICENSE) © 2026 7ZAI

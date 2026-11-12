# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context.**

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root（已建：Node 环境引导 / 探测 / Agent 管理域 等术语）。
- **`docs/adr/`**: read ADRs that touch the area you're about to work in（已建：`0001-agent-hub-node-bootstrap.md`（原 agent-hub 的 Node 引导，已随并入迁入 bedcode）/ `0002-agent-hub-merge-into-bedcode.md`）。

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── apps/
    ├──（agent-hub 已并入 bedcode，目录删除）
    ├── ai-chatbox/
    ├── bedcode/
    └── ...
```

The repo is a pnpm workspace of independent apps, but the domain vocabulary is shared across apps (agent / CLI / mount / preview / plugin …). Keep one root glossary unless a term is genuinely app-scoped; if that happens, migrate to `GLOSSARY-MAP.md` + per-app glossaries rather than inventing synonyms.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (…), but worth reopening because…_

## Repo-specific pointers

- Product/architecture vocabulary also lives in `AGENTS.md` (§1 定位与冲突裁决, §2 三仓边界) and `docs/CODE-MAP.md`.
- Cross-repo contracts (WIT / SDK / permissions) are **not** defined here; treat the platform repo and capability repo as their sources of truth.

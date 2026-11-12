# Triage Labels

The skills speak in terms of five canonical triage **state** roles and two **category** roles. This file maps those roles to the actual label strings used in this repo's issue tracker (`7ZAI/wasmnest-apps`).

## State roles（每个 issue 恰好一个）

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

## Category roles（每个 issue 恰好一个）

| Label in mattpocock/skills | Label in our tracker | Meaning                        |
| -------------------------- | -------------------- | ------------------------------ |
| `bug`                      | `kind:bug`           | 缺陷                           |
| `enhancement`              | `kind:feature`       | 新功能 / 新应用 / 改进         |

`kind:contract`（契约/WIT/ABI）与 `kind:chore`（治理/清理）不参与 triage 的类别二选一：它们是本仓 `issues.md` 定义的**类型**标签，按需与状态标签并存。

## 与共享规范的差异（有意为之）

四仓共享规范 `../wasmnest/docs/public/issues.md` §4 写着「标签四仓统一，不新增」，且只列了 `kind:*` 与 `cross-repo`。本仓的五个**状态**标签是工程 skills（`/triage`、`/to-spec`）的运行前提，由用户 2026-10-21 裁决在本仓先行引入：

- 它们补充的是**状态机**，不替代 `kind:*` 类型标签；
- 若要做四仓统一，应修订共享 `issues.md`，而不是在本仓删标签；
- 新增 agent 专用标签（`wayfinder:*`）时同样在此登记。

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

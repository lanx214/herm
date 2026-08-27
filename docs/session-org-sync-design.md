# herm 会话「文件夹 / 星标」与桌面端「项目」互通设计方案

> 提案文档 · 未定稿 · 2026-08
> 目的：让 herm（TUI）与 Hermes 桌面端的会话组织方式"双向互通"，把决定权交给用户。

---

## 0. TL;DR（三句话）

1. 桌面端的「项目」**已经是后端单源**（`projects.db` + `project_tree.py`），且读写 RPC 齐全；herm 接同一批 RPC 即可读写它 —— **不需要同步引擎，只需要"共源"**。
2. 唯一的硬门槛：**桌面 App 是 Nous 闭源软件**，你改不了它的 UI。哪些东西能"双向"、哪些只能"等官方"，第 3 节划清楚了。
3. 有一个**决定性约束**（大多数人会忽略）：桌面项目对会话的归组是**按 `session.cwd` 落到项目 `folders[].path` 的前缀**算的，**没有「按会话 id 强制归组」的机制**。这让 herm 的"手动主题文件夹"（未完成/社科课题）**不能原样映射成桌面项目**——除非给后端补一个能力。

---

## 1. 现状盘点（谁的数据存哪）

| 数据 | 归属 | 存哪 | 谁能读写 |
|---|---|---|---|
| herm「文件夹」`folders{}` `folderNames[]` | herm fork 私有 | `~/.hermes/herm/tui.json` 的 `sessions` 段 | **只有 herm**（后端不认） |
| herm「星标」`starred[]` | herm fork 私有 | 同上 | **只有 herm** |
| 桌面「项目」显式项目 | 后端 | `~/.hermes/projects.db`（`projects` / `project_folders` / `project_meta`） | 后端 RPC + 桌面 |
| 桌面「项目」自动目录 | 后端 | state.db 会话的 `cwd`/`git_repo_root` 推导 | 后端 RPC + 桌面 |
| 会话行本身 | 后端 | `~/.hermes/state.db` `sessions` 表 | 后端 + herm（直读） |

**state.db `sessions` 表已有这些列（关键）**：`id, cwd, git_branch, git_repo_root, pinned, hidden, archived, title, last_activity_at…`

> 彩蛋：`sessions.pinned` 这列**已存在**——「星标」其实天然可以落在这里，后端/桌面语义早就有了（`methods_config.py` 注释里就提到 `pinned`）。

### ✅ 已实测确认（2026-08-27）
用户在桌面端把「当前对话」**置顶**后，`~/.hermes/state.db` 里该会话 `sessions.pinned` 由 0 → **1**（且是当时唯一 pinned=1）。**结论：桌面「置顶/取消置顶」直接写的就是 `sessions.pinned` 这一列，与 herm 星标共用同一字段 → 双向互通成立，无需额外建模。** 桌面端确实有可点的「置顶」开关（非仅排序）。剩余实现 = 把 herm 的星标从 `tui.json.starred` 迁移到 `sessions.pinned`。

### 🛠️ 实现状态（2026-08-27，方案① herm 直读写，已完成待验证）
已在 herm fork 落地（未推送）：
- `sessions-db.ts` 新增 `pinnedIds()`（读全部 pinned id）+ `setPinned(id, v)`（写 `sessions.pinned`，同时写目标 id 与压缩根，沿用旧星标的 lineage-root 思路）
- `io/fns.ts` 注册 `pinnedIds`（worker 读）
- `Sessions.tsx`：星标改为 `useState`，从 DB 播种 + legacy `tui.json.starred` 一次性迁移到 pinned 并清 prefs；`toggleStar` 写 pinned；`load()` 刷新（桌面置顶不重启也能浮现）；删会话时清 pinned
- `test/sessions.test.tsx`：NOIO 补 `pinned/setPinned` 桩；search-star 测试改为断言 `setPinned` 调用
- **待办**：`bunx tsc --noEmit` → `bun test` → `bun run build` → 重启 herm 本地试用 → 确认后 push（需在场审批）

---

## 2. 桌面「项目」的归属算法（决定一切的约束）

`tui_gateway/project_tree.py`：

- 会话 → 项目：`_project_for_session()` 拿会话的 **`cwd`（或其 git 仓库根）** 去匹配「显式项目挂的 folder path 前缀」，**最深的前缀胜出**。
- 显式项目字段（`projects.create`）：`name, slug, folders[], primary_path, description, icon, color, board_slug`。
- 即：**一个会话属于哪个项目，完全由它的 cwd 落在哪个目录决定，无法用手/别的字段硬塞。**

**推论**：桌面项目本质是「**目录工作区**」。herm 的「未完成 / 社科课题」是「**自由标签**」。两者语义不同，想互通必须先做一次取舍（见第 4 节）。

后端 RPC 面（herm 可直接调用）：
- 读：`projects.tree`、`projects.project_sessions`、`projects.discover_repos`
- 写：`projects.create` / `projects.update` / `projects.add_folder` / `projects.remove_folder` / `projects.set_primary` / `projects.set_active` / `projects.archive` / `projects.delete`
- （目前没有）`sessions` 的 `pinned` / 项目归属的**写 RPC** —— 需要补（见方案 B）。

---

## 3. 「双向互通」到底指什么（先分解再谈方案）

"双向同步"拆成三根，诚实标注可行性：

| 目标 | 含义 | 现在能落地? |
|---|---|---|
| **P1** 桌面组织的项目 → herm **能看** | herm 显示桌面同款 项目→分支→会话 分组 | ✅ 现在就能做（herm 读 `projects.tree`，或按同规则本地算） |
| **P2** herm 能**操作**桌面项目 | 新建/改名/设色/归档、把会话挪进某项目 | 🟡 新建/改名/设色/归档**能**（写 RPC 齐全）；**「把会话挪进某项目」**目前**不能**——归属是 cwd 算的，需要补能力 |
| **P3** herm 的**星标 & 主题文件夹** → 桌面 **能看到并操作** | 桌面的会话列表显示 ★、显示「未完成」这种标签行 | 🔴 **被桌面闭源 UI 卡住**。数据能做到后端共享，但"桌面用 UI 显示/编辑"要 Nous 官方加 |

> **结论**：P1 与 P2 的项目级部分 = **现在就能真双向**；P3 主题标签=「数据能共享、UI 待官方」。文档建议分轨道处理，而不是一个模型硬吞全部。

---

## 4. 核心决策：herm「文件夹」怎么建模（三选一）

### 方案 ① 文件夹 → 映射成「后端显式项目」（真双向，推荐做 P1+P2）
- 把 herm 的 `folders` 落成后端显式项目（`projects.create`：name=标签名，icon/color 可选）。
- **符合的场景**：文件夹本身就是目录工作区（如 `/root/herm`、某个研究仓库）→ 完全对得上，桌面原生显示，双向成立。
- **不符合的场景**：纯主题标签（「未完成」「社科课题」不是目录）→ 桌面项目模型按路径归组，塞不进；必须配方案②里的"会话归属覆盖能力"才成立。

### 方案 ② 主题文件夹 → 后端「按 id 的会话归属覆盖」（📌 新增能力，打通"主题文件夹也想双向"）
- 在后端加一小块：`sessions` 可被强制归属到某项目（无视 cwd）。存法示例：`project_meta` 加 `session_overrides`，或 `sessions` 表加 `project_override`。
- `_project_for_session()` **先查 override，再走路径匹配**。
- 这样 herm 的「未完成」=「一个后端项目，里面是 override 挂进去的会话」。
- **代价**：要动后端逻辑 + 加 1 个录 override 的 RPC；桌面是否渲染这种"无目录项目"仍需验证（闭源 UI 的不确定点）。
- 划算吗：**只有在"你确实想让主题文件夹在桌面也出现"时才做**。若桌面只是看目录项目、主题文件夹只在 herm 里整理，则不需要它。

### 方案 ③ herm 独有标签保持在 herm 私有（不做双向，最省事）
- 保持现状（存 `tui.json`），只把「星标」升级成后端 `sessions.pinned` 以便跨端一致。
- 主题文件夹桌面看不见。**适合**：不在乎桌面显示主题标签的人。

---

## 5. 推荐分阶段路线（"双向但别太麻烦" = 共源 + 分轨道）

| 阶段 | 做什么 | 方向 | 动的代码 | 依赖 |
|---|---|---|---|---|
| **S1（立竿见影）** | 星标从 herm 私有 → **后端 `sessions.pinned`**；文件夹先落成后端显式项目（目录类的） | herm→后端 | 只改 **herm fork**（把按钮从写 tui.json 改成走 RPC）+ 后端补 1 个写 `pinned` 的 RPC | 无 |
| **S2（反向通）** | herm 的 Sessions 加「**项目视图**」：读 `projects.tree`，显示和桌面一模一样的 项目→分支→会话；并复用写 RPC 做新建/改名/设色/归档、把目录会话挪进项目 | 双向(P1+P2 目录侧) | 只改 **herm fork** | S1 |
| **S3（可选，主题文件夹上桌面）** | 按方案②加「会话→项目 override」，让「未完成/社科课题」也能成后端项目、尝试在桌面显示 | bidirectional 主题侧 | **后端**（override + RPC）+ herm | 需验证桌面渲染无目录项目；或者**提 feature 给 Nous** |
| **S4（桌面 UI 展示，长期）** | 桌面原生显示 star 徽标/主题标签行 | 桌面→双向 | **Nous 闭源 app** | 提 RFC/feature，你够不着，只能等 |

**为什么这样最省事**：
- 全程**不写"同步器"**，只是把数据从 herm 私有挪到后端共源，天然双向。
- S1+S2 覆盖"桌面目录项目 ↔ herm"这条主链路，改动基本集中在**你完全可控的 herm fork** 上，后端只需 1 个很轻的 RPC。
- 唯一够不着的 S4 被显式隔离，不阻塞其余。

---

## 6. 风险与诚实标注

1. **桌面闭源**：P3/S4（主题标签、星标徽标在桌面 UI 显示）你无法自行实现，只能沿用共享数据 + 等 Nous 支持。
2. **归属算法差异**：herm 本地按"同规则复算"项目归属时，若 git 状态与后端不一致（远程后端/已删目录），分组可能与桌面有一两处出入；**P2 直接读 `projects.tree` 可避免此问题**（以后端为唯一权威）。
3. **新增 override 会改变 `_project_for_session` 语义**：必须确保 override 只在显式配置时不干扰自动归组（回退路径完整），并有测试覆盖。
4. **迁移**：现有 `tui.json` 里的 `folders{}`/`starred[]` 需一次性搬运到新存储（脚本迁移，可留原文件备份）。

---

## 7. 验证方式（每阶段怎么确认做对了）

- S1：herm 里点星 → `state.db.sessions.pinned` 变 1；`projects.tree` 里能看到新建的项目。
- S2：桌面建/改项目 → herm「项目视图」刷新即变；herm 里挪目录会话/改名 → 桌面刷新即变（双向闭环）。
- S3：override 后 `_project_for_session` 单测：override 命中时忽略 cwd、无 override 时走原路径匹配（回归测试保底）。
- 全程：`bun test`（herm）+ 后端对应 pytest，跑通再 `bun run build`，你本地重启试用确认后再推送。

---

## 8. 拍板问题（决定走哪条）

- **Q1 主题文件夹要不要上桌面？**
  - 要 → 需要 S3（后端加 override，成本中等）去打通"主题文件夹在桌面可见"；
  - 不要 → 只做 S1+S2，主题文件夹保持 herm 私有，成本最低，星标/目录项目仍双向。
- **Q2 目录类文件夹（真实仓库/工作区）要不要跟桌面项目打通？**
  - 这是 S2 的范围，建议默认做（改动全在 herm，双向最实在）。
- **Q3 愿不愿意接受"星标落 `sessions.pinned`"这种后端共源写法**（桌面显示待官方）？

> 我的默认建议：**S1 + S2 先行**（目录项目的真双向 + 星标后端化），主题文件夹先保持 herm 私有，等你想清楚要不要花成本上桌面再说。
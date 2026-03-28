# 「项目立项 → 小说导入 → 分集剧情大纲 → ep01 剧本落地」纵向链路设计

> 适用范围：FEICAI Studio 第一阶段里程碑
> 目标：在现有 `feicai-studio` 代码基础上，形成一条从立项到 `ep01` 剧本落盘的可实现闭环，并且不阻断后续“导演分析 → 服化道 → 分镜”的三阶段制片流程。

---

## 1. 设计结论摘要

这条纵向链路的核心设计结论如下：

1. **项目根目录仍然是唯一工作目录**，`project-config.json` 只保存静态配置，`script/`、`assets/`、`outputs/`、`novel/` 保存业务产物，SQLite 只做索引和摘要，不回写派生状态。
2. **小说绑定支持两种入口**：
   - 本地章节目录 / txt 文件导入 → 写入 `novel/`；
   - 长文本粘贴 / 单文档导入 → 写入 `novel/original-content.md`。
   两者都通过 `project-config.json.originalContent` 建立绑定元信息。
3. **分集剧情大纲的规范真相源应为结构化文件**，推荐使用现有 `plot-breakdown.json` 作为第一阶段规范存储；`project-config.json.episodeOutlines` 仅保留轻量镜像，供列表/摘要展示。
4. **剧本阶段的逻辑主键必须是 episodeNumber，而不是 filePath**。如果最终文件名采用 `script/ep01-标题.md`，版本链不能再绑死到文件路径，否则改标题即丢历史。
5. **主进程负责所有文件写入、版本归档、IPC 编排和 Agent 调用；渲染进程只负责表单、编辑器和状态展示；Agent/CLI 只负责生成草稿，不直接决定项目状态。**
6. **第一阶段最小可交付闭环**：
   - 立项保存基础信息；
   - 导入小说并绑定到项目；
   - 生成 / 编辑 ep01 大纲；
   - 从 ep01 大纲生成剧本草稿并保存；
   - 可查看最低限度的剧本版本历史；
   - 该剧本随后可直接成为制作阶段输入。

---

## 2. 当前代码基础与可直接复用部分

当前代码已经具备较好的骨架，可以直接复用：

### 2.1 可复用的静态配置与状态边界

- `src/main/project/project-config-store.ts`
  - 已经统一了 `project-config.json` 的读写。
- `docs/STATE_SOURCES.md`
  - 已明确：`project-config.json` 只保存静态配置；SQLite 负责索引；项目目录文件是真实内容源。
- `src/main/db/queries.ts`
  - 已支持通过配置快照同步数据库项目摘要。

### 2.2 可复用的内容服务

- `src/main/project/project-content-service.ts`
  - 已经具备：
    - `readNovelContent/saveNovelContent`
    - `listEpisodeOutlines/getEpisodeOutline/saveEpisodeOutline/deleteEpisodeOutline/generateEpisodeOutline`
    - `generateEpisodeScript`
    - `listScriptVersions`
- `src/main/ipc/project-file-handlers.ts`
  - 已暴露上述内容能力对应的 IPC。

### 2.3 可复用的剧本与版本基础设施

- `src/main/project/script-file-utils.ts`
  - 已有 script 文件解析与写入路径逻辑。
- `src/main/project/artifact-service.ts`
  - 已支持内容快照与版本归档。
- `src/shared/types.ts`
  - 已有 `NovelContentDocument`、`EpisodeOutline`、`ScriptVersionSummary` 等基础类型。

### 2.4 可复用的前端入口

- `src/renderer/pages/ProjectLaunchPage.tsx`
  - 已经是这条纵向链路的雏形页面。
- `src/renderer/pages/SourceWorkspacePage.tsx`
  - 已把“小说源稿 + 改编规划”收口到“内容准备”。
- `src/renderer/pages/ScriptWorkspacePage.tsx`
  - 已把“剧本创作 + 问题面板”收口到统一工作区。

### 2.5 当前明显缺口

1. **小说导入存在双轨但未统一说明**：
   - `NovelManager` 偏章节目录；
   - `project-content-service` 偏单文档正文。
2. **大纲真相源存在两份**：
   - `plot-breakdown.json`（结构化）
   - `project-config.json.episodeOutlines`（轻量摘要）
   需要明确主从关系。
3. **原著正文没有独立 artifact kind**：
   - 目前 `saveNovelContent` 写入时仍借用了 `plot_breakdown` 类型，不利于后续治理。
4. **script 文件命名与版本作用域耦合过紧**：
   - 当前 artifact 作用域包含 filePath；
   - 如果未来支持 `ep01-标题.md`，改标题会断版本链。
5. **ProjectLaunchPage 仍有一部分能力直接写 `project-config.json` 摘要，而不是完全走结构化大纲服务**。

---

## 3. 项目工作目录设计

以项目根目录为唯一工作目录，建议保持如下结构：

```text
<project-root>/
├── project-config.json              # 静态项目配置（唯一配置源）
├── adapt-plan.json                  # 后续改编规划（保留）
├── plot-breakdown.json              # 分集剧情大纲 / 结构化拆解真相源
├── plot-breakdown.md                # 兼容旧编剧管线的导出/桥接文件（可选保留）
├── novel/
│   ├── chapter-0001.txt             # 章节化导入内容
│   ├── chapter-0002.txt
│   └── original-content.md          # 长文本正文导入/粘贴版
├── script/
│   ├── ep01-标题.md                 # 用户最终可见剧本文件（目标形态）
│   └── ...
├── assets/
│   ├── character-prompts.md         # 制作阶段共享资产
│   └── scene-prompts.md
└── outputs/
    ├── ep001/
    │   ├── 01-director-analysis.md
    │   └── 02-seedance-prompts.md
    ├── artifacts/
    │   ├── manifest.json            # 版本清单
    │   └── snapshots/
    └── pipeline-state.json
```

### 3.1 四类目录职责

#### A. `project-config.json`

只保存：
- 项目基础信息
- 静态创作设定
- 原著绑定元信息
- 大纲轻量摘要镜像
- 流程参数

**不保存**：
- 当前运行状态
- 每集是否已完成制作
- 实时扫描得出的派生结果
- 版本历史

#### B. `novel/`

保存“原著输入层”，是写作链路的最上游原料。

#### C. `script/`

保存“分集剧本定稿层”，是制作链路的直接输入。

#### D. `assets/` 与 `outputs/`

是后续三阶段制片产物层：
- `assets/` 为跨集共享资产；
- `outputs/` 为逐集制作输出与版本快照。

### 3.2 `script/assets/outputs` 之间的关系

关系应定义为：

- `script/`：**写作交付物**，是制作的输入。
- `assets/`：**制作阶段累积的公共资产库**，由剧本/导演分析反向驱动生成。
- `outputs/`：**逐集制作输出**，由 `script/` 和 `assets/` 驱动。

即：

```text
project-config + novel -> plot-breakdown -> script -> outputs(+ assets)
```

而不是：

```text
script 与 outputs 并列互相覆盖
```

---

## 4. 数据模型设计

## 4.1 项目实体 / 配置结构

基于现有 `ProjectConfig`，建议继续沿用并明确字段语义：

```ts
interface ProjectConfig {
  projectName: string
  sourceType?: 'novel' | 'script' | 'original'
  phase?: 'writing' | 'production'
  totalEpisodes: number
  visualStyle: string
  targetMedium: string
  workingDirectory?: string

  novelTitle?: string
  novelGenre?: string
  originalContent?: OriginalContentMetadata

  episodeOutlines?: EpisodeOutlineItem[] // 轻量摘要镜像，不是完整真相源

  createdAt: string
  pipelineSettings?: PipelineSettings
  adaptSettings?: AdaptSettings
  reviewPolicy?: ReviewPolicyConfig
  flowConfig?: FlowConfig
}
```

### 建议补充的语义约束

- `workingDirectory === projectPath`
- `phase`：
  - `writing`：立项 / 小说 / 大纲 / 剧本阶段
  - `production`：导演/服化道/分镜阶段
- `episodeOutlines` 只保留列表摘要：
  - `episodeNumber`
  - `title`
  - `summary`

不再承载场景级数据。

## 4.2 小说绑定模型

现有 `OriginalContentMetadata` 可继续扩展为统一绑定入口：

```ts
interface OriginalContentMetadata {
  title?: string
  genre?: string
  author?: string
  sourcePath?: string
  contentPath?: string
  importedAt?: string
  contentFormat?: 'text' | 'chapters'
}
```

### 语义定义

- `contentFormat = 'chapters'`
  - 表示项目使用 `novel/chapter-*.txt` 作为原著来源。
- `contentFormat = 'text'`
  - 表示项目使用 `novel/original-content.md` 作为原著来源。
- `sourcePath`
  - 记录外部来源路径，仅用于溯源与二次导入提示，不作为运行时真相源。
- `contentPath`
  - 记录项目内主内容路径。

### 推荐补充字段

```ts
interface OriginalContentMetadata {
  ...
  bindingMode?: 'external_import' | 'inline_paste'
  chapterCount?: number
}
```

用途：
- 前端快速知道是“目录导入”还是“粘贴正文”；
- Dashboard / Launch 页面可以直接显示是否完成绑定。

## 4.3 分集剧情大纲模型

现有 `EpisodeOutline` 已足够作为第一阶段规范模型：

```ts
interface EpisodeOutline {
  episodeNumber: number
  code: string
  title: string
  logline?: string
  summary: string
  sourceChapters: number[]
  scenes: EpisodeOutlineScene[]
  status: 'draft' | 'reviewed'
  updatedAt: string
}
```

### 真相源建议

- **规范真相源**：`plot-breakdown.json`
- **轻量镜像**：`project-config.json.episodeOutlines`
- **兼容桥接**：`plot-breakdown.md`（如旧 adapt 管线仍依赖 markdown）

### 为什么不能只放 `project-config.json`

因为大纲会逐渐变成中等复杂结构：
- 分场
- source chapters
- AI 草稿状态
- 人工校订状态
- 后续可能加角色/冲突标签

如果全塞进 `project-config.json`：
- 配置文件会膨胀；
- 与静态配置边界混乱；
- 不利于后续独立版本化。

## 4.4 剧本模型与版本模型

### 逻辑主键

剧本的逻辑主键应为：

```ts
ScriptKey = `episode:${episodeNumber}`
```

而不是某个物理文件路径。

### 物理文件

目标形态支持：

```text
script/ep01-标题.md
```

### 最低版本管理要求

至少满足：

1. 每次保存剧本都进入 artifact manifest；
2. 可以按集查看所有历史版本；
3. 标题变化导致文件重命名时，历史版本不能丢；
4. 当前版本与历史快照可区分。

### 因此需要的设计调整

当前 `artifact-service` 的作用域是：

```text
kind + episodeNum + filePath
```

对于 `script/ep01-标题.md` 不够稳定。建议改为：

```text
kind + logicalKey
```

例如：

```ts
logicalKey = `script_episode:ep01`
```

快照仍然可以继续存储在：

```text
outputs/artifacts/snapshots/script_episode/ep001/v0001.md
```

这样即使 `ep01-宫墙夜雨.md` 改成 `ep01-冷宫重逢.md`，版本链也不会断。

---

## 5. 四步业务流程设计

## 5.1 第一步：项目立项与配置

### 目标

在项目创建后，先把“谁、做什么、用什么风格”固定下来，作为整个写作与制作链路的共用上下文。

### 输入

- 项目名称
- 原著名称
- 题材类型
- 目标媒介
- 视觉风格
- 工作目录（即 projectPath）

### 写入

- `project-config.json`
- SQLite `projects` 摘要表

### 状态结果

`launch.projectConfigured = true`

### 推荐前端形态

沿用 `ProjectLaunchPage` 的第一屏表单，但保存动作必须全部走：

```text
Renderer -> IPC.PROJECT_SAVE_CONFIG -> Main/project-config-store -> SQLite snapshot sync
```

### 约束

- `workingDirectory` 自动等于 `projectPath`，不允许单独编辑。
- `sourceType` 由是否绑定小说决定：
  - 本链路默认立项后切到 `novel`
- `phase` 在此阶段固定为 `writing`

## 5.2 第二步：小说导入

### 目标

把原著与当前项目绑定，并把原著内容落到项目目录内部，避免后续依赖外部文件路径。

### 支持两种导入模式

#### 模式 A：本地章节目录 / txt 文件导入

适合：
- 已拆章的网文；
- 本地文件批量导入。

**存储策略**：
- 复制到 `novel/chapter-0001.txt` 等文件；
- `project-config.originalContent.contentFormat = 'chapters'`
- `sourcePath` 只做来源记录。

#### 模式 B：长文本正文粘贴 / 单文档导入

适合：
- 只有一份全文；
- 从网页/外部文档粘贴正文。

**存储策略**：
- 写入 `novel/original-content.md`；
- `project-config.originalContent.contentFormat = 'text'`；
- 后续如需章节拆分，可由 AI / 工具再切章。

### 推荐统一原则

**无论输入来自哪里，运行时都只读取项目目录内副本。**

### 状态结果

`launch.novelBound = true`

### 当前实现建议

- 保留 `NovelManager.importNovel` 负责章节文件导入；
- 保留 `saveNovelContent` 负责长文本导入；
- 在 UI 层把两者收敛到一个“绑定小说”动作下。

### 当前需要修正的点

建议新增 artifact kind：

```ts
type ArtifactKind = ... | 'novel_content'
```

并让 `saveNovelContent` 使用 `novel_content`，不要继续复用 `plot_breakdown`。

## 5.3 第三步：分集剧情大纲

### 目标

从已绑定原著得到 `ep01 / ep02 / ...` 的分集剧情大纲，并允许“AI 起草 + 人工编辑”。

### 核心原则

- 大纲不是剧本；
- 大纲是“写作设计稿 / 分集规划稿”；
- 剧本是“可交付给制作阶段的正式文本”。

### 推荐流程

#### 方案：AI 起草 + 人工编辑（推荐）

1. 用户绑定小说；
2. 用户设置 `totalEpisodes` 或目标范围；
3. 用户触发“生成分集大纲”；
4. Agent/LLM 基于小说内容起草 `EpisodeOutline[]`；
5. 主进程将结果写入 `plot-breakdown.json`；
6. 前端进入大纲编辑器逐集修改；
7. 用户将某一集标记为 `reviewed`；
8. `reviewed` 的大纲可进入剧本生成。

### 存储位置

#### 规范层

- `plot-breakdown.json`：完整结构化大纲

#### 镜像层

- `project-config.json.episodeOutlines`：
  - 仅用于摘要展示
  - 可供 Dashboard / Launch 快速展示每集标题与摘要

#### 兼容层

- `plot-breakdown.md`：
  - 仅在旧 adapt 管线仍依赖 markdown 时同步输出
  - 不建议作为新纵向链路的唯一真相源

### 与 `script/` 的区分

| 对象 | 用途 | 真相源 | 面向谁 |
|---|---|---|---|
| 分集剧情大纲 | 规划剧情、切分章节、组织分场 | `plot-breakdown.json` | 编剧 / 策划 |
| 分集剧本 | 正式脚本、进入导演分析的输入 | `script/ep01-*.md` | 编剧 / 导演 / 制作 |

### 状态结果

- `launch.outlinesDrafted = true`
- 当至少 ep01 为 `reviewed`：`launch.ep01OutlineReady = true`

## 5.4 第四步：ep01 剧本落地

### 目标

从 ep01 大纲出发，形成可编辑、可保存、可追溯版本的剧本文件，并能直接成为制作阶段输入。

### 推荐流程

1. 用户选择 ep01；
2. 若没有大纲，先引导生成 / 编辑 ep01 大纲；
3. 用户点击“生成剧本草稿”；
4. Main 调用 Agent/LLM，基于 ep01 大纲生成剧本草稿；
5. 草稿写入 `script/ep01-标题.md`；
6. 用户在编辑器继续人工修改；
7. 每次保存进入 artifact manifest；
8. 至少保留版本列表；
9. 当用户点击“设为定稿”或满足最小检查时，标记该集可进入制作阶段。

### 文件命名建议

如果本轮必须支持标题型文件名，建议使用：

```text
script/ep01-<slug>.md
```

例如：

```text
script/ep01-冷宫初见.md
```

### 兼容策略

`script-file-utils` 需扩展支持：

```regex
^ep(\d+)(?:-[^.]+)?\.md$
```

并以 `episodeNumber` 解析，不再要求必须是 `ep001.md` 这种纯数字文件名。

### 最低版本管理要求

#### 必做

- 保存即归档快照；
- 可列出历史版本；
- 当前版本可识别；
- 改标题重命名不丢版本链。

#### 可延后

- 版本 diff 可视化
- 回滚预览
- 评论 / 审批流

### 状态结果

- `launch.ep01ScriptDrafted = true`
- `launch.ep01ScriptSaved = true`
- 若用户确认可交付：`launch.ep01ScriptReadyForProduction = true`

---

## 6. 主进程 / 渲染进程 / Agent / CLI 职责划分

## 6.1 渲染进程职责

渲染进程只负责：

1. 展示项目启动工作流页面；
2. 收集用户输入；
3. 展示小说预览 / 大纲编辑 / 剧本编辑；
4. 发起 IPC 调用；
5. 展示 AI 任务状态、错误和保存结果。

**不负责**：
- 直接读写文件；
- 决定版本号；
- 改写数据库；
- 直接调用 LLM provider。

## 6.2 主进程职责

主进程是这条链路的真正编排者，负责：

1. 路径安全校验；
2. 文件读写；
3. `project-config.json` 规范化保存；
4. 大纲 / 剧本的结构化持久化；
5. 版本快照归档；
6. SQLite 摘要同步；
7. 调用 LLM provider / Agent；
8. 长任务事件推送到渲染进程。

## 6.3 Agent / CLI 职责

Agent/CLI 只负责“内容生成与审核”，包括：

- 根据原著起草分集大纲；
- 根据单集大纲起草剧本；
- 后续可扩展为剧本修订建议、冲突检查、角色一致性检查。

**Agent/CLI 不应直接负责**：
- 决定项目状态；
- 直接写项目文件；
- 直接更新 SQLite；
- 决定哪个文件是当前正式版本。

应采用如下模式：

```text
Renderer -> Main IPC -> Main service/orchestrator -> Agent/LLM -> Main persist -> Renderer refresh
```

---

## 7. IPC / 服务接口设计

## 7.1 本轮可直接复用的 IPC

### 项目与配置

- `IPC.PROJECT_READ_CONFIG`
- `IPC.PROJECT_SAVE_CONFIG`

### 小说

- `IPC.NOVEL_IMPORT`
- `IPC.NOVEL_READ_CHAPTER`
- `IPC.NOVEL_READ_CONTENT`
- `IPC.NOVEL_SAVE_CONTENT`
- `IPC.NOVEL_GET_INFO`

### 大纲

- `IPC.PLOT_LIST_EPISODE_OUTLINES`
- `IPC.PLOT_GET_EPISODE_OUTLINE`
- `IPC.PLOT_SAVE_EPISODE_OUTLINE`
- `IPC.PLOT_DELETE_EPISODE_OUTLINE`
- `IPC.PLOT_GENERATE_EPISODE_OUTLINE`

### 剧本

- `IPC.SCRIPT_READ_EPISODE`
- `IPC.SCRIPT_SAVE_EPISODE`
- `IPC.SCRIPT_GENERATE_EPISODE`
- `IPC.SCRIPT_LIST_VERSIONS`

## 7.2 推荐补充的聚合 IPC

为了让 `ProjectLaunchPage` 不再自己拼四段状态，建议新增一个聚合查询接口：

```ts
IPC.PROJECT_GET_LAUNCH_STATUS = 'project:getLaunchStatus'
```

返回：

```ts
interface ProjectLaunchStatus {
  projectConfigured: boolean
  novelBound: boolean
  novelMode?: 'chapters' | 'text'
  totalChapters?: number
  outlineCount: number
  reviewedOutlineCount: number
  ep01OutlineReady: boolean
  ep01ScriptExists: boolean
  ep01VersionCount: number
  nextRecommendedAction:
    | 'save_project_config'
    | 'bind_novel'
    | 'draft_outlines'
    | 'review_ep01_outline'
    | 'generate_ep01_script'
    | 'edit_ep01_script'
    | 'ready_for_production'
}
```

好处：
- 前端不再重复拼装判断；
- QA 有稳定断言对象；
- 后续 Dashboard / Workspace 也可复用。

## 7.3 推荐补充的生成接口

### A. 批量生成大纲

当前只有单集 `PLOT_GENERATE_EPISODE_OUTLINE`，建议补：

```ts
IPC.PLOT_GENERATE_OUTLINE_BATCH = 'plot:generateOutlineBatch'
```

输入：

```ts
{
  projectPath: string
  startEpisode?: number
  endEpisode?: number
  replaceExisting?: boolean
}
```

### B. 剧本发布 / 重命名接口

如果采用 `ep01-标题.md`，建议新增：

```ts
IPC.SCRIPT_PUBLISH_EPISODE = 'script:publishEpisode'
```

输入：

```ts
{
  projectPath: string
  episodeNumber: number
  title: string
  content: string
}
```

职责：
- 根据标题生成文件名；
- 保持 episode 逻辑主键稳定；
- 写入版本快照；
- 如已有旧文件则安全迁移。

---

## 8. 状态流转示意

## 8.1 项目启动纵向链路状态

```text
[project_created]
  -> 保存基础配置
[project_configured]
  -> 绑定原著（章节导入 / 长文本导入）
[novel_bound]
  -> AI 起草分集大纲
[outlines_drafted]
  -> 人工编辑并确认 ep01
[ep01_outline_reviewed]
  -> AI 起草 ep01 剧本
[ep01_script_drafted]
  -> 人工编辑并保存
[ep01_script_saved]
  -> 可进入制作阶段
[ready_for_production]
```

## 8.2 主进程与 Agent 交互

```text
Renderer(ProjectLaunchPage)
  -> IPC.PLOT_GENERATE_OUTLINE_BATCH / IPC.PLOT_GENERATE_EPISODE_OUTLINE
Main(project-content-service + orchestrator)
  -> load novel content + project config
  -> call Agent/LLM
  -> persist plot-breakdown.json
  -> mirror summary to project-config.json
  -> sync SQLite summary
  -> return structured result
Renderer refreshes UI
```

```text
Renderer(Script editor)
  -> IPC.SCRIPT_GENERATE_EPISODE
Main
  -> load ep01 outline
  -> call Agent/LLM
  -> persist script file
  -> write artifact version
  -> sync episode projection
Renderer shows content + version list
```

---

## 9. 与后续三阶段制片的衔接

这条纵向链路必须保证后续可以无缝进入：

```text
ep01 script -> director analysis -> art design -> storyboard prompts
```

因此需要明确几个衔接约束：

1. **剧本必须是项目内文件**，不能依赖外部临时文本；
2. **每集必须有稳定的 episodeNumber**，后续 `outputs/ep001/`、`assets` 引用都依赖它；
3. **大纲与剧本是写作阶段产物，不应提前写进 `outputs/`**；
4. **phase 切换只能发生在“剧本可交付”之后**；
5. **制作阶段永远读取 `script/`，而不是重新从大纲生成。**

### 推荐的切换门槛

当满足以下条件时，项目可从 `writing` 切到 `production`：

- `projectConfigured = true`
- `novelBound = true`（如果 sourceType = novel）
- 至少存在 1 份正式剧本文件
- ep01 至少存在 1 个当前版本

---

## 10. 里程碑实现建议（按角色）

## 10.1 Backend / Main 进程

### 必做

1. 明确 `plot-breakdown.json` 为大纲真相源；
2. 新增 `novel_content` artifact kind；
3. 新增 `PROJECT_GET_LAUNCH_STATUS` 聚合接口；
4. 大纲保存统一走 `project-content-service`，不要只写 `project-config.json.episodeOutlines`；
5. 扩展 `script-file-utils` 以支持 `ep01-标题.md` 或在本轮明确保留稳定命名策略；
6. 让剧本版本作用域按 episode 逻辑键，而不是按 filePath。

### 建议随后做

7. 批量大纲生成接口；
8. 剧本发布 / 安全重命名接口；
9. 大纲与剧本生成任务的流式事件推送。

## 10.2 Frontend

### 必做

1. `ProjectLaunchPage` 改为真正消费结构化大纲接口；
2. 将“大纲保存”从直接写 config 摘要升级为调用 `PLOT_SAVE_EPISODE_OUTLINE`；
3. 小说导入入口明确显示两种模式：目录导入 / 长文本导入；
4. ep01 剧本区增加“生成草稿”“查看版本”入口；
5. 用 `PROJECT_GET_LAUNCH_STATUS` 驱动步骤状态与 CTA。

## 10.3 QA

### 必测场景

1. 创建项目后保存基础信息，重启应用仍能恢复；
2. 导入章节目录后，`novel/` 内文件完整，项目状态正确；
3. 粘贴长文本后，`novel/original-content.md` 可读且能重新打开；
4. 保存 ep01 大纲后，`plot-breakdown.json` 与 `project-config.json` 摘要一致；
5. 生成 ep01 剧本后，`script/` 有文件且可再次打开；
6. 连续保存剧本 3 次后，版本列表正确；
7. 修改剧本标题导致文件名变化时，版本历史仍连续；
8. 从写作阶段切到制作阶段后，制作页能正确读取 ep01 剧本。

---

## 11. 风险与决策点

## 11.1 风险一：继续把大纲只存 `project-config.json`

后果：
- 配置膨胀；
- 与静态配置混淆；
- 后续分场与审核扩展困难。

**建议**：坚决以 `plot-breakdown.json` 为真相源。

## 11.2 风险二：标题型 script 文件名直接进入现有 artifact 作用域

后果：
- 改标题即丢版本链；
- QA 无法验证“同一集”的连续历史。

**建议**：script 版本作用域改为 episode 逻辑键。

## 11.3 风险三：Renderer 直接拼过多业务状态

后果：
- 页面判断重复；
- 规则散落；
- Workspace 和 Launch 页面难以一致。

**建议**：新增聚合状态 IPC，由 main 统一给出 launch readiness。

---

## 12. 推荐实施顺序

### P0：打通最小闭环

1. 配置保存稳定化
2. 小说双模式绑定稳定化
3. `plot-breakdown.json` 大纲保存稳定化
4. ep01 剧本生成 + 保存 + 版本列表
5. Launch 页面按聚合状态显示下一步

### P1：补齐易用性

6. 批量生成 ep01~epN 大纲
7. 标题型 script 文件名支持
8. 剧本发布 / 重命名
9. 大纲 reviewed 状态与制作就绪判断

### P2：衔接制作阶段

10. 写作交付 checklist
11. 从 Launch / ScriptWorkspace 一键进入 ProductionWorkspace
12. 将 ep01 剧本直接作为导演阶段输入

---

## 13. 最终推荐方案（供本轮实施采纳）

如果本轮只允许做一套最稳方案，建议采用以下落地版本：

### 方案基线

- `project-config.json`：只管静态配置与轻量摘要
- `novel/`：同时支持章节目录与 `original-content.md`
- `plot-breakdown.json`：大纲真相源
- `script/`：剧本真相源
- `outputs/artifacts/manifest.json`：最低版本管理真相源

### 本轮必须达成的用户体验

用户进入“项目启动流程”后，能连续完成：

1. 保存项目基础信息
2. 导入小说
3. 生成 / 编辑 ep01 大纲
4. 生成 / 编辑 ep01 剧本
5. 查看“该项目已具备进入制作阶段的最小条件”

这条链路一旦稳定，后续三阶段制片就可以直接把 `script/ep01` 作为输入继续推进，而无需返工项目结构。

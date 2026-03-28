# FEICAI Studio 产品文档（草案）

> 版本：v0.1（草案）
> 适用范围：feicai-studio 桌面应用整体产品视图
> 面向角色：产品经理、设计、研发、运营

---

## 1. 产品定位

### 1.1 核心定位

FEICAI Studio 是一款面向影视创作团队的「AI 制片工作站」，支持从长篇小说/剧情设定出发，一路生成到 Seedance 2.0 视频提示词的完整生产线。

用一句话概括：

> 从 小说 → 剧情拆解 → 分集剧本 → 导演讲戏 → 服化道设计 → Seedance 分镜提示词 → 导出，
> FEICAI Studio 将整条链路封装为一个可视化、可追踪、可审核的 AI 生产流水线。

### 1.2 目标用户

- 影视/短剧制片人、导演组
- 新媒体内容团队（短剧、广告、MV 等）
- IP 方/版权方：希望从小说/世界观快速批量孵化视听内容

### 1.3 典型使用场景

- 已有连载/长篇小说，希望批量改编成短剧/小程序短剧
- 原创 IP 项目，从设定到剧本文本再到分镜提示词的一站式开发
- 批量生成基于同一世界观的多个中短篇故事，并快速出镜头级提示词

---

## 2. 核心价值与功能总览

### 2.1 核心价值

1. **长链路统一管理**：从小说章节到 Seedance 提示词，所有中间产物都在同一项目下可视化管理。
2. **可控的 AI 生产线**：每个阶段都有明确的状态机、可暂停/恢复/重试，避免“一键生成不可控”。
3. **内置审核与合规**：三层防偏 + 两步审核机制，将业务审核与内容合规模块化。
4. **资产可积累可复用**：人物、场景、美术提示词集中管理，可跨集复用，构建项目级资产库。
5. **易于导出与对接**：支持导出 Seedance 提示词/全部产出，方便接入后续画图工具或生产系统。
6. **可交付可诊断**：应用内可以直接看到交付就绪状态、运行日志路径和诊断导出入口，而不是把交付检查留在终端命令里。

### 2.2 模块总览

按用户旅程拆分模块：

1. 项目与配置
2. Novel：小说导入与管理
3. Breakdown：剧情拆解与改编规划
4. Script：按集剧本管理
5. Pipeline：导演-服化道-分镜生产线
6. Review：审核与问题反馈
7. Export：导出产出与提示词

---

## 3. 用户旅程（从 0 到导出）

本节从“一个新项目，从小说开始，最终导出 Seedance 提示词”的典型路径，描述用户视角的完整流程。

### 3.1 Step 0：创建项目 & 配置 LLM

**入口页面**：
- Dashboard（项目列表）
- ProjectPage（项目详情）
- SettingsPage（设置/LLM 配置）

**用户操作**：
1. 在 Dashboard 中创建新项目，指定：
   - 项目名称
   - 项目路径（本地目录）
2. 进入 Settings 设置页，配置至少一个 LLM Provider：
   - Anthropic / OpenAI / Gemini
   - API Key、模型名称、超时时间等
3. 保存后，LLM 配置会作为默认配置，供 Novel/Breakdown/Pipeline 等模块使用。

**后台关键点**：
- 应用启动时自动加载已保存的 LLM 配置，确保之后的编剧/生产线功能可用。

**验收标准**：
- 未配置 LLM 时，Novel/Breakdown/Pipeline 等需要调用模型的操作应给出清晰错误提示。

---

### 3.2 Step 1：Novel — 导入/管理小说章节

**入口页面**：
- `/project/:id/novel` → NovelPage

**用户操作**：
1. 点击“导入小说”按钮，选择：
   - 单个 `.txt` 文件，或
   - 包含多个章节文件的目录（推荐命名为 `chapter-0001.txt` 形式）。
2. 导入成功后，在 Novel 页面看到：
   - 小说章节总数
   - 章节编号范围（如 0001-0030）
3. 后续可再次导入补充章节（覆盖/追加逻辑由后端管理）。

**后台逻辑（简述）**：
- 使用 NovelManager：
  - `importNovel(sourcePath, projectPath)` 将章节复制到 `<projectPath>/novel/` 目录。
  - 支持：
    - 完整章节目录导入（批量复制 `chapter-*.txt`）
    - 单文件导入（支持自动按顺序编号）。
  - `scanNovelDir(novelDir)` 统计章节总数与范围，用于 UI 展示和后续拆解。

**数据形态**：
- 章节文件：`novel/chapter-0001.txt`, `chapter-0002.txt`, ...

**验收点**：
- 导入后刷新页面能看到章节统计信息。
- 不规范命名的单文件 `.txt` 被自动重命名为下一章节编号。

---

### 3.3 Step 2：Breakdown — 剧情拆解 & 改编规划

**入口页面**：
- `/project/:id/breakdown` → BreakdownPage

**用户操作**：
1. 初次使用时，点击“初始化改编引擎”：
   - 若未配置 LLM，应提示用户跳转设置页配置。
2. 在顶部区域选择操作：
   - “拆解 N 章”：从小说章节中拆解出新的剧情点批次。
   - “自动拆解”：由系统根据当前水位策略自动决定拆解多少章。
3. 在中部/下方面板查看：
   - 批次列表：如“第 1 批（第 1-5 章）”、“第 2 批（第 6-10 章）”。
   - 每批中的剧情点列表：
     - `【剧情1】场景，描述，钩子类型，第X集，状态：未用/已用`
   - 剧情水位：
     - 剩余未用剧情点数量
     - 已拆解章节数 / 总章节数
     - 已覆盖的集数等
4. 打开“改编规划”Tab：
   - 查看基于当前剧情拆解生成的全局改编规划（例如每一卷/季的集数分布、节奏安排）。
   - 支持“一键生成/更新改编规划”。

**后台逻辑（简述）**：
- 拆解和规划的具体 LLM 调用由 adapt 管线负责。
- PlotBreakdownParser 负责解析与维护 `plot-breakdown.md`：
  - 解析小说名称、类型。
  - 解析每个批次头：`### 第N批（第A-B章）`。
  - 解析批次中的剧情点：
    - `【剧情1】场景，描述，钩子类型，第X集，状态：未用/已用`。
  - 提供水位计算：未用剧情点、已拆章节数、已完成集数等。

**数据形态**：
- `plot-breakdown.md` 样例结构：
  - 小说元信息：
    - `**小说名称**： 《XXX》`
    - `**小说类型**： YYY`
  - 多个批次：
    - `### 第1批（第1-5章）`
    - `【剧情1】……状态：未用`
    - `【剧情2】……状态：已用`
  - 改编规划：
    - `## 改编规划` / `## 改编计划` / `## Adaptation Plan`

**验收点**：
- 拆解完成后，刷新 Breakdown 页面可以看到最新批次和水位信息。
- 改编规划区域可以从 `plot-breakdown.md` 中自动识别对应章节块。

---

### 3.4 Step 3：Script — 按集剧本

**入口页面**：
- `/project/:id/script` → ScriptEditorPage

**用户操作**：
1. 在页面左侧/顶部选择要编辑的集数（EP01 / EP02 / ...）。
2. 在编辑区域中：
   - 查看当前集数的剧本文本。
   - 手动编辑、润色、加台词等。
3. 保存当前集剧本：
   - 自动写入 `script/epXXX.md`。

**后台逻辑（简述）**：
- AssetManager：
  - `loadScript(episodeNum)` 从 `script/epXXX.md` 读取文本。
  - `saveScript(episodeNum, content)` 写回文件，必要时创建 `script/` 目录。
- 剧本可以来自：
  - 前一阶段 Breakdown/Adapt 根据剧情点生成的初稿。
  - 用户手动新写/粘贴。

**数据形态**：
- `script/ep001.md`, `script/ep002.md`, ...
- 每份剧本为 Markdown 文本，内部结构由导演技能/后续流水线约定（可包含场次头、角色列表等）。

**验收点**：
- 未创建过剧本文件时，打开对应集数应有合理的空状态提示。
- 保存后再次打开同一集数，应能看到刚才编辑的内容。

---

### 3.5 Step 4：Pipeline — 导演 → 服化道 → 分镜

**入口页面**：
- `/project/:id/pipeline` → PipelinePage

**用户操作**：
1. 在顶部选择：
   - 当前项目
   - 当前集数（如 EP01）
2. 在项目配置区域设置：
   - 视觉风格（例如“真人写实 / 日漫 / 3D CG”等）
   - 目标媒介（电影 / 短剧 / 广告 / MV 等）
   - 每集总时长、单条提示词时长上限（可选）
3. 点击“启动流水线”：
   - 支持两种模式：
     - 全阶段：导演 → 服化道 → 分镜 一次跑完整集。
     - 单阶段：仅跑当前阶段（用于修正、重跑）。
4. 在阶段列表中查看：
   - 阶段状态：执行中 / 审核中 / 完成 / 出错 / 暂停。
   - 流式输出：实时看到 LLM 输出的文本。
   - 审核结果：PASS/FAIL、评分、关键反馈。
5. 如审核未通过，可以：
   - 查看详细反馈。
   - 重新触发同一阶段（流水线会自动带上上一次的审核反馈）。

**后台逻辑（简述）**：
- PipelineStateMachine 负责整个流程的状态管理与调度：
  - 状态流转：
    - `idle → script_loaded → director_analyzing → director_reviewing`
    - → PASS → `director_done → art_designing → art_reviewing`
    - → PASS → `art_done → storyboard_writing → storyboard_reviewing`
    - → PASS → `episode_complete`
  - `start(params)`：
    - 检查 LLM Provider 是否配置。
    - 读取剧本：`script/epXXX.md`。
    - 初始化项目上下文和持久化状态。
    - 根据 startStage/singleStage 执行 `executeFullStage(stage)`。
  - `executeStage(stage)`：
    - 加载对应技能（director-skill / art-design-skill / seedance-storyboard-skill）。
    - `gatherInputs(stage)` 收集：
      - 本集剧本：`script/epXXX.md`
      - 已有人物/场景素材：`assets/character-prompts.md`, `assets/scene-prompts.md`
      - 导演分析讲戏本：`outputs/epXXX/01-director-analysis.md`（在 art/storyboard 阶段使用）。
    - 调用 PromptAssembler 组装 Prompt。
    - 使用对应 LLM Provider 流式生成产物。
    - 写入阶段产出文件（见下文数据形态）。
  - `executeReview(stage)`：
    - 调用 ReviewEngine.review 进行两步审核（见 3.6 节）。
    - 审核通过 → 标记阶段完成、持久化。
    - 审核失败 → 保存反馈，按配置自动重试，重试时 Feedback 会注入到 Prompt 中。

**数据形态（以 EP01 为例）**：
- 输入：
  - `script/ep001.md`
  - `assets/character-prompts.md`
  - `assets/scene-prompts.md`
- 中间产物：
  - 导演分析：`outputs/ep001/01-director-analysis.md`
  - 服化道原始产出：`outputs/ep001/01.5-art-design-output.md`
  - 同步/合并更新：`assets/character-prompts.md`, `assets/scene-prompts.md`
- 最终产物：
  - Seedance 提示词脚本：`outputs/ep001/02-seedance-prompts.md`

**验收点**：
- 未配置 LLM 时，点击启动流水线会有明确错误提示。
- 未找到对应剧本时，状态机启动应失败并给出提示（而不是静默报错）。
- 执行过程中的状态变化和日志，应能在前端实时看到。

---

### 3.6 Step 5：Review — 三层防偏 + 两步审核

**入口页面**：
- PipelinePage 的阶段卡片中（每阶段都显示审核状态与反馈）。
- `/project/:id/review` → ReviewPage（集中查看全部审核记录）。

**用户操作**：
1. 在 Pipeline_page 里：
   - 直接看到每个阶段的审核状态（PASS/FAIL）和分数（例如 7.5/10）。
   - 展开查看详细问题列表和修改建议。
2. 在 ReviewPage 中：
   - 查看历史审核记录（按集数/阶段过滤）。
   - 对多次失败的阶段，分析审核意见变化情况。

**后台逻辑（简述）**：
- ReviewEngine：
  - `review(stage, ctx)`：
    1. 第一层：断点清洗
       - 从文件系统重新读取产出，不依赖内存中的输出。
       - 导演/分镜：根据阶段映射读取 `outputs/epXXX/01-*.md` 或 `02-seedance-prompts.md`。
       - 服化道：读取 `outputs/epXXX/01.5-art-design-output.md`。
    2. 第二层：对抗性立场
       - 使用 ANTIBIAS_PROMPT，假设“输出存在问题”，强制审核模型主动找茬。
    3. 第三层：评分锚定
       - 以 7 分为基准，只有逐项验证后才上调，避免默认高分。
    4. 两步审核：
       - 业务审核（对应 stage 的 script/art/seedance 审核 skill）。
       - 合规审核（统一使用 compliance-review-skill）。
    5. 综合结果：
       - 最终 PASS = 业务通过 AND 合规通过。
       - 综合反馈包含两部分：
         - 业务审核总结 + 评分。
         - 合规审核总结。

**与流水线的交互**：
- ReviewResult 被 PipelineStateMachine 存入上下文，并触发日志和前端事件。
- 审核失败时，反馈文本会在下一次重试的 Prompt 中作为“上次审核未通过，请根据以下反馈修改”的输入部分。

**验收点**：
- 在 FAIL 场景下，重试生成应明显体现审核意见的改动。
- 业务通过但合规失败时，最终结论仍为 FAIL，并有清晰标注。

---

### 3.7 Step 6：Export — 导出提示词 / 全部产出

**入口页面**：
- 在 PromptPage / PipelinePage 等页面，通过按钮打开 ExportModal。

**用户操作**：
1. 导出提示词：
   - 选择导出集数范围（例如 EP01~EP12）。
   - 选择导出格式：
     - Markdown：适合直接阅读/归档。
     - JSON：适合程序二次处理。
     - CSV：适合在 Excel 等表格工具中查看。
   - 点击“导出提示词”，选择保存路径。
2. 导出全部产出：
   - 点击“导出全部产出”。
   - 选择一个目标目录。
   - 系统将当前项目的 `outputs/` + `assets/` 目录拷贝到目标目录下的 `<项目名>-export` 子目录中。

**后台逻辑（简述）**：
- ExportHandlers：
  - `EXPORT_PROMPTS`：
    - 读取所选集数范围内的 `outputs/epXXX/02-seedance-prompts.md`。
    - 根据格式：
      - Markdown：在每集前面加 `# EPXXX`，并用 `---` 分隔。
      - JSON：输出 `[{ episode, content }, ...]`。
      - CSV：按 `## 标题` 拆分为多行记录，列为 `集数, 标题, 内容`。
  - `EXPORT_ALL`：
    - 将 `outputs/` 和 `assets/` 目录递归复制到目标目录。

**验收点**：
- 未选择有效集数范围时，按钮应禁用或给出提示。
- 导出失败（无文件/权限等）时，需给出明确的错误 toast。

---

## 4. 数据流总览（概要）

从 IO 角度，主要实体与文件如下：

- 输入
  - `novel/*.txt`：原始小说章节。
- 中间产物
  - `plot-breakdown.md`：剧情拆解批次 + 剧情点 + 改编规划。
  - `script/epXXX.md`：按集剧本。
  - `assets/character-prompts.md`：项目级人物提示词库。
  - `assets/scene-prompts.md`：项目级场景提示词库。
  - `outputs/epXXX/01-director-analysis.md`：导演分析/讲戏本。
  - `outputs/epXXX/01.5-art-design-output.md`：服化道阶段原始产出。
- 最终产物
  - `outputs/epXXX/02-seedance-prompts.md`：Seedance 2.0 分镜提示词脚本。
  - 导出文件：
    - `<项目名>-prompts-epX-Y.md/json/csv`
    - `<项目名>-export/outputs + assets` 整体目录。

---

## 5. 后续规划（可选）

> 以下为产品层面可选扩展点，非当前版本必需。

1. **更多管线可视化**
   - 在 Dashboard/ProjectPage 增加整体进度视图：
     - Novel → Breakdown → Script → Pipeline → Export 各阶段完成度。
   - 支持按阶段过滤显示项目状态。

2. **多人协作与锁定机制**
   - 剧本/提示词编辑支持锁定，避免多人同时覆盖写入。
   - 定义“只读项目”和“编辑项目”的权限模式。

3. **更多导出格式**
   - 支持直接导出 Seedance 兼容的 JSON/脚本格式。
   - 支持导出用于第三方剪辑软件的 EDL/时间线草稿（基于提示词时长）。

4. **模板与预设**
   - 项目模板：不同类型（短剧/广告/MV）的默认参数组合。
   - 视觉风格预设：供 Pipeline 快速切换“风格模板”。

---

> 本文档为 v0.1 草案，可在研发/设计评审后按实际实现补充：
> - 各页面的 UI 线框图/交互动线
> - 关键错误场景及恢复策略
> - 与外部系统的具体对接规范（Seedance/画图工具等）。

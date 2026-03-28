# EP01 服化道 → 分镜 / Seedance（~prompt）回归测试方案

## 目标

保证分镜 / Seedance 提示词阶段第一条 Happy Path 可稳定回归：

1. EP01 已存在导演分析与服化道产物，可作为分镜阶段输入
2. 系统能从 assets 中定位当前集对应的人物 / 场景提示词片段
3. 用户从 Pipeline 页面或项目命令触发 `~prompt`
4. 系统写入 `outputs/ep001/02-seedance-prompts.md`
5. 业务审核 / 合规审核通过后，EP01 状态推进到 `complete`
6. 审核失败时保留反馈，不误判“单集完成”
7. `~status` / 项目状态刷新后，前端能看到 EP01 已完成，并显示提示词条数与时长

## 一、关键节点与核心用例

| 节点 | 风险点 | 核心用例 |
| --- | --- | --- |
| 读取导演分析 | 读取错误集数或缺失时仍误跑分镜 | 1. EP01 仅有 `01-director-analysis.md` 时可作为输入；2. 缺分析时不应判定 complete |
| 提取本集资产片段 | `assets/character-prompts.md` / `scene-prompts.md` 中提取到了其他集内容；提取不到当前集片段 | 1. 仅定位 EP01 段落；2. 缺当前集片段时前端给出空态提示 |
| 启动分镜（`~prompt`） | 未路由到 `startStage=storyboard`；仍从前一阶段执行 | 1. Pipeline 单阶段从 storyboard 启动；2. 产物写入 Prompt 文件 |
| Seedance 提示词落盘 | 输出目录 / 文件名错误；artifact kind 错误 | 1. 写入 `outputs/ep001/02-seedance-prompts.md`；2. artifact kind 为 `seedance_prompts` |
| 单集完成判定 | 只要有 Prompt 文件就误判 complete；或审核通过后仍未完成 | 1. 导演分析 + Prompt 文件存在时判定 complete；2. 仅 Prompt 无导演分析时保留 storyboard |
| 业务审核 / 合规审核通过 | PASS 后未推进 complete；review 丢失 | 1. PASS 后 `pipeline-state.json` 中 completedStages 包含 storyboard；2. status=complete |
| 审核失败回路 | FAIL 时 `~status` 仍显示已完成；用户看不到反馈 | 1. FAIL 仅保留 review，不误推进已完成状态；2. 状态文案为“审核失败待处理” |
| `~status` 状态更新 | Prompt 文件已落盘但 summary 未更新 | 1. `~status` 统计 complete=1；2. 文本包含提示词条数 / 时长 |
| 前端反馈 | 用户无法确认本集已完成、无法查看当前集资产片段 | 1. Prompt Workspace 能显示 EP01 资产片段；2. Project / Production 页面看到“提示词已完成 / 已完成” |

## 二、自动化测试落地范围

本轮优先覆盖最容易出错的后端服务层 / 纯函数 / 状态更新逻辑。

### 本轮新增 / 加强覆盖

1. **项目进度推断与 `~status` 回归**
   - `src/main/project/project-progress.test.ts`
   - 新增覆盖：
     - `02-seedance-prompts.md` + 导演分析存在时，EP01 判定为 `complete`
     - 仅有 Prompt 文件、缺导演分析时，状态保留为 `storyboard`
     - storyboard review FAIL 时，状态文案为“审核失败待处理”，但底层状态仍反映当前已具备 Prompt 产物
     - `runProjectCommand('~status')` 返回已完成统计、提示词条数和总时长

2. **审核回路状态持久化**
   - `src/main/engine/project-state.test.ts`
   - 新增覆盖：
     - storyboard FAIL 只追加 review，不提前推进 `complete`
     - storyboard PASS 后才推进 `completedStages += storyboard` 且状态变为 `complete`

3. **单集完成判定 / 文件落地基础**
   - `src/main/project/episode-projection.test.ts`
   - 现有覆盖已验证：
     - `01-director-analysis.md` + `02-seedance-prompts.md` 同时存在时，EP01 为 `complete`
     - Prompt 内容能反推出 `totalPrompts` 与 `totalDurationSeconds`

4. **本集资产新增边界**
   - `src/main/engine/art-output-merger.test.ts`
   - 现有覆盖继续作为分镜上游保障：
     - `character_prompts` / `scene_prompts` artifact 带 `metadata.episodeNum=1`
     - 为 Prompt Workspace 的“当前集资产片段”定位提供稳定输入格式

### 建议后续继续补充

1. **PipelineStateMachine 单阶段 storyboard 集成测试**
   - 目标文件：`src/main/engine/state-machine.ts`
   - 校验：
     - `gatherInputs('storyboard')` 同时读取导演分析、角色提示词、场景提示词
     - `writeStageOutput('storyboard')` 写入 Prompt 文件并更新 `seedancePromptsPath`
     - review PASS / FAIL 后状态与 `lastReviewFeedback` 正确流转

2. **Prompt Workspace 片段提取测试**
   - 目标文件：`src/renderer/hooks/usePromptWorkspace.ts`
   - 校验：
     - `extractEpisodeAssetSection()` 对 `## EP01` / `## 第1集` / `### EP01` 变体均可命中
     - 缺当前集片段时返回空字符串

3. **Renderer / Store 状态反馈测试**
   - 目标文件：`src/renderer/stores/projectStore.ts`
   - 校验：
     - `syncEpisodeStatus('status-command')` 成功后提示 `~status 已刷新`
     - complete 状态的 summary / toast 与结构化数据一致

## 三、前端 / 桌面端手工验收脚本

### 场景 A：EP01 服化道完成后触发分镜 / Seedance Happy Path

前置条件：
- 已创建项目
- 项目目录下已有：
  - `script/ep001.md`
  - `outputs/ep001/01-director-analysis.md`
  - `outputs/ep001/01.5-art-design-output.md`
  - `assets/character-prompts.md`
  - `assets/scene-prompts.md`
- 当前集资产文件中包含 EP01 专属段落（如 `## EP01` / `## 第1集`）
- 已配置默认 LLM

步骤：
1. 打开项目，进入 **Production / Pipeline 页面**。
2. 选择当前项目与 EP01。
3. 确认 EP01 当前状态为“服化道”或“待生成提示词”。
4. 打开 **Prompt Workspace** 或与分镜相关的工作区。
5. 检查“资产提示词”标签页：
   - 应能看到从 `assets/character-prompts.md` 提取出的 EP01 人物片段
   - 应能看到从 `assets/scene-prompts.md` 提取出的 EP01 场景片段
6. 返回 Pipeline 区域，选择 **单阶段运行**，起始阶段设为 **分镜 / storyboard**。
7. 点击“启动流水线”或通过项目命令触发 `~prompt ep01`。
8. 观察页面反馈：
   - storyboard 阶段先进入 `执行中`
   - 随后进入 `审核中`
   - 日志中可看到分镜阶段开始执行
9. 等待执行完成。
10. 检查磁盘产物：
    - `outputs/ep001/02-seedance-prompts.md` 已生成
11. 打开 Prompt Workspace：
    - 能读到新的 Prompt 文本
    - 能看到提示词条数与总时长（如页面展示）
12. 刷新项目状态（对应一次 `~status`）。
13. 确认 EP01 状态已从“服化道”变为“已完成”。
14. 确认页面文案显示提示词已完成，且条数 / 时长与文件内容一致。

通过标准：
- 能成功从服化道进入单阶段分镜流程
- 文件真实落盘到 `outputs/ep001/02-seedance-prompts.md`
- 刷新后 EP01 状态正确显示为已完成
- 前端可见 Prompt 结果与当前集资产片段

### 场景 B：审核失败回路

前置条件：
- 可构造一轮 storyboard review FAIL（例如输出缺少关键镜头、未引用本集资产）

步骤：
1. 在 Pipeline 页面触发 EP01 分镜单阶段执行。
2. 等待进入审核阶段并返回 FAIL。
3. 观察页面状态提示，确认 storyboard 阶段出现失败 / 待处理文案。
4. 刷新项目状态。
5. 确认 EP01 **没有**被当作稳定完成结果对外展示；若页面显示完成基础状态，也必须伴随“审核失败待处理”标记。
6. 检查 `outputs/pipeline-state.json`：
   - 存在 stage=`storyboard` 的 review 记录
   - 反馈文本可用于下一轮修订
7. 如页面提供重试入口，确认用户可基于该反馈再次运行。

通过标准：
- FAIL 时 review 反馈有落盘
- 状态视图明确提示“审核失败待处理”
- 不会静默把失败结果当作已通过的单集完成

### 场景 C：`~status` / 状态刷新可见性

步骤：
1. 在 EP01 只有导演分析 + 服化道、尚未执行分镜时，查看项目状态。
2. 记录此时 EP01 状态应为“服化道”。
3. 执行一次 EP01 分镜。
4. 等待 Prompt 文件生成完成。
5. 执行一次状态刷新（对应 `~status` 行为）。
6. 确认页面提示类似“`~status 已刷新`”。
7. 确认 EP01 状态已更新为“已完成”。
8. 确认状态详情包含：
   - Prompt 条数
   - 总时长
   - 必要时仍可看到 assets 新增 / 提示词完成等辅助信息

通过标准：
- 刷新前后状态变化与磁盘产物一致
- 前端状态文案与结构化数据一致
- `~status` 结果能稳定回答“EP01 是否已完成”

## 四、推荐执行命令

### 本轮最小自动化回归

```bash
npm test -- src/main/project/episode-projection.test.ts src/main/project/project-progress.test.ts src/main/engine/project-state.test.ts src/main/engine/art-output-merger.test.ts
```

### 若需要扩大到分镜链路相关基础集

```bash
npm test -- src/main/project/episode-projection.test.ts src/main/project/project-progress.test.ts src/main/engine/project-state.test.ts src/main/engine/art-output-merger.test.ts src/main/project/artifact-service.test.ts
```

## 五、当前结论

分镜 / Seedance 阶段 Happy Path 最关键的风险点集中在五处：

1. 当前集资产片段是否能正确定位到 EP01
2. `outputs/ep001/02-seedance-prompts.md` 是否真实落盘
3. storyboard 审核 FAIL 时是否误判单集完成
4. 审核 PASS 后是否正确推进到 `complete`
5. `~status` / 前端刷新后是否及时反映 Prompt 条数、时长与完成状态

本轮已优先补上这些节点对应的后端自动化回归，并补充桌面端可执行的手工验收脚本，可作为“EP01 服化道 → 分镜 / Seedance”第一条回归基线。

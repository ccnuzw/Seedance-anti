# EP01 导演分析 → 服化道（~design）回归测试方案

## 目标

保证服化道阶段第一条 Happy Path 可稳定回归：

1. EP01 已存在导演分析产物，可作为服化道阶段输入
2. 用户从 Pipeline 页面或项目命令触发 `~design`
3. 系统写入 `outputs/ep001/01.5-art-design-output.md`
4. 系统把本集新增内容合并到 `assets/character-prompts.md`、`assets/scene-prompts.md`
5. 业务审核 / 合规审核通过后，EP01 状态推进到 `art`
6. 审核失败时保留反馈，不误推进状态
7. `~status` / 项目状态刷新后，前端能看到 EP01 已进入服化道阶段

## 一、关键节点与核心用例

| 节点 | 风险点 | 核心用例 |
| --- | --- | --- |
| 读取导演分析 | `outputs/ep001/01-director-analysis.md` 缺失时仍允许跑服化道；读取了错误集数 | 1. 仅有 EP01 导演分析时允许启动；2. 缺少导演分析时 `~design` 不应误成功 |
| 启动服化道（`~design`） | 命令未路由到 `startStage=art`；仍从导演阶段开始；单阶段模式失效 | 1. `runProjectCommand('~design ep01')` 走 `art` 单阶段；2. 输出文案明确为服化道阶段 |
| 服化道原始产物落盘 | 输出目录/命名错误 | 1. 产物写入 `outputs/ep001/01.5-art-design-output.md`；2. artifact kind 为 `art_output` |
| 本集新增内容合并到 assets | 新增内容未写入；同名素材重复堆积；人物/场景只写一侧 | 1. 成功写入 `assets/character-prompts.md` 与 `assets/scene-prompts.md`；2. rerun 覆盖同名基底素材而非无限追加 |
| 本集新增边界 | manifest / 状态更新无法识别“这是 EP01 新增” | 1. `character_prompts` / `scene_prompts` artifact 带 `metadata.episodeNum=1`；2. `calculateProjectProgress()` 正确标记 `hasAssetUpdates` |
| 业务审核 / 合规审核通过 | PASS 后状态未推进；审核记录丢失 | 1. PASS 后 EP01 状态推进到 `art`；2. review 写入 `outputs/pipeline-state.json` |
| 审核失败回路 | FAIL 时错误推进到 `art` 已完成；反馈未保留 | 1. FAIL 只追加 review，不推进 completedStages；2. 进度视图显示“审核失败待处理” |
| `~status` 状态更新 | assets 已更新但 `~status` 仍停留在导演阶段 | 1. 合并后 `~status` 显示“服化道”；2. 输出附带 `assets新增:character+scene` |
| 前端反馈 | 用户无法确认服化道完成与资产已更新 | 1. Pipeline 页面可看到 art 状态变化；2. Asset Workspace 可看到新增角色 / 场景 |

## 二、自动化测试落地范围

本轮优先覆盖最容易出错的后端服务层 / 纯函数 / 状态更新逻辑。

### 已补充 / 已覆盖

1. **项目进度推断与 `~status` 回归**
   - `src/main/project/project-progress.test.ts`
   - 覆盖：
     - EP01 仅有导演分析时停留在 `director`
     - 服化道产物 + 本集 assets manifest 存在时推进到 `art`
     - `art_designing` 运行中时显示 `服化道进行中`
     - 最新 art review 为 FAIL 时显示 `审核失败待处理`
     - `runProjectCommand('~status')` 文本和结构化结果同时包含 `assets新增:character+scene`
     - `~design ep01` 命令形态被接受并路由到服化道命令入口

2. **审核回路状态持久化**
   - `src/main/engine/project-state.test.ts`
   - 现有覆盖可直接复用于服化道阶段审核回路语义：
     - FAIL 审核只追加 review，不提前推进 completedStages
     - PASS 后才推进阶段状态
     - review 去重与 `outputs/pipeline-state.json` 落盘

3. **项目状态同步到数据库 Episode 记录**
   - `src/main/db/queries.test.ts`
   - 现有覆盖保证文件系统状态会刷新到 Episode 列表；本轮重点依赖 `project-progress` 对 art 状态的推导

4. **assets 合并与本集新增 artifact 记录**
   - `src/main/engine/art-output-merger.test.ts`
   - 覆盖：
     - 角色 / 场景提示词同时落盘到 assets
     - rerun 覆盖同名素材、保留变体
     - Happy Path 合并后会登记 `character_prompts` / `scene_prompts` 当前 artifact，且 `metadata.episodeNum=1`

### 建议后续继续补充

1. **PipelineStateMachine 单阶段 art 集成测试**
   - 目标文件：`src/main/engine/state-machine.ts`
   - 校验：
     - `gatherInputs('art')` 读取导演分析
     - `writeStageOutput('art')` 同时写入 art 原始产物和 assets
     - review PASS / FAIL 后事件与状态正确流转

2. **Renderer / Store 测试**
   - 目标文件：`src/renderer/stores/projectStore.ts`
   - 校验：
     - `syncEpisodeStatus('status-command')` 成功后提示 `~status 已刷新...`
     - 失败时保留旧 episodes

3. **Asset Workspace 联动测试**
   - 目标文件：`src/renderer/hooks/useAssetWorkspace.ts`
   - 校验：
     - 状态刷新后可以读到新增角色 / 场景
     - 页面空态与新增后的列表态切换正常

## 三、前端 / 桌面端手工验收脚本

### 场景 A：EP01 导演分析结果触发服化道 Happy Path

前置条件：
- 已创建项目
- 项目目录下已有：
  - `script/ep001.md`
  - `outputs/ep001/01-director-analysis.md`
- 已配置默认 LLM

步骤：
1. 打开项目，进入 **Pipeline 页面**（`/project/:id/pipeline`）。
2. 在顶部选择当前项目与 EP01。
3. 确认页面当前阶段可切换到 **服化道 / art**，且能看见已存在的导演分析阶段结果。
4. 选择 **单阶段运行**，起始阶段设为 **服化道**。
5. 点击“启动流水线”或通过项目命令触发 `~design ep01`。
6. 观察页面反馈：
   - art 阶段状态先进入 `执行中`，随后进入 `审核中`
   - 日志中可看到服化道阶段开始执行
7. 等待执行完成。
8. 检查磁盘产物：
   - `outputs/ep001/01.5-art-design-output.md` 已生成
   - `assets/character-prompts.md` 已更新
   - `assets/scene-prompts.md` 已更新
9. 打开 **Asset Workspace**（素材页）。
10. 确认可看到本轮新增的角色提示词与场景提示词；必要时切换 EP01 查看。
11. 回到项目页或执行一次状态刷新（对应 `~status`）。
12. 确认 EP01 状态已从“导演分析”变为“服化道”。
13. 确认刷新后的状态文案能体现 assets 已新增（若页面展示该信息）。

通过标准：
- 能成功从导演分析进入单阶段服化道流程
- 文件真实落盘到 `outputs/ep001/01.5-art-design-output.md`
- `assets/character-prompts.md` 与 `assets/scene-prompts.md` 都被更新
- 刷新后 EP01 状态正确显示为服化道阶段

### 场景 B：审核失败回路

前置条件：
- 可构造一轮 art review FAIL（例如使用测试 prompt 产出明显缺失的角色 / 场景描述）

步骤：
1. 在 Pipeline 页面触发 EP01 服化道单阶段执行。
2. 等待进入审核阶段并返回 FAIL。
3. 观察页面状态提示，确认 art 阶段出现失败 / 待处理文案。
4. 刷新项目状态。
5. 确认 EP01 **没有**被错误标记为“服化道已完成”。
6. 检查 `outputs/pipeline-state.json`：
   - 存在 stage=`art` 的 review 记录
   - 反馈文本可用于下一轮修订

通过标准：
- FAIL 时状态不误推进
- review 反馈有落盘，下一轮修订可追踪
- 进度视图显示“审核失败待处理”而不是“已完成”

### 场景 C：`~status` / 状态刷新可见性

步骤：
1. 在 EP01 只有导演分析、尚未执行服化道时，查看项目状态。
2. 记录此时 EP01 状态应为“导演分析”。
3. 执行一次 EP01 服化道。
4. 等待 assets 合并完成。
5. 执行一次状态刷新（对应 `~status` 行为）。
6. 确认页面提示类似“`~status 已刷新`”。
7. 确认 EP01 状态已更新为“服化道”。
8. 如页面支持详细状态，确认能看到本集存在角色 / 场景 assets 新增。

通过标准：
- 刷新前后状态变化与磁盘产物一致
- 前端状态文案与结构化数据一致
- `~status` 结果不丢失本集新增 assets 信息

## 四、推荐执行命令

### 本轮最小自动化回归

```bash
npm test -- src/main/project/project-progress.test.ts src/main/engine/project-state.test.ts src/main/engine/art-output-merger.test.ts src/main/db/queries.test.ts
```

### 若需要扩大到项目状态相关基础集

```bash
npm test -- src/main/project/episode-projection.test.ts src/main/project/project-progress.test.ts src/main/engine/project-state.test.ts src/main/engine/art-output-merger.test.ts src/main/db/queries.test.ts
```

## 五、当前结论

服化道阶段 Happy Path 最关键的风险点集中在五处：

1. `outputs/ep001/01.5-art-design-output.md` 是否真实落盘
2. `assets/character-prompts.md`、`assets/scene-prompts.md` 是否都被更新
3. 本集新增内容是否能被正确标记为 EP01 新增并反馈到状态系统
4. 审核 FAIL 时是否错误推进状态
5. `~status` / 前端刷新后是否能及时反映为 `art`

本轮已优先补上这些节点对应的后端自动化回归，并补充桌面端可执行的手工验收脚本，可作为“EP01 导演分析 → 服化道”第一条回归基线。

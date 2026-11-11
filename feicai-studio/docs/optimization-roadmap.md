# 并发调度、数据规范与产品优化实施路线

本文基于 `master a7dbc26` 的源码只读调研。目标是让现有制作能力更易理解、稳定持续运行、灵活推进，并逐步支持可靠的批量并发。本文是待实施设计，不代表并发或下述数据协议已实现；不改变现有架构文档、测试矩阵的历史事实。

当前第一批有两项任务**正在实现、尚待各自验收**：制作总控入口适配与状态指引；现有 8 项 pipeline 参数统一合同。本文只定义它们与后续工作的衔接，不预判其他任务的合并结果。基线 README 记录了 79 个测试文件、614 项测试及 Electron 冒烟结果；本次文档工作没有重跑这些生产检查，也没有访问真实 userData、凭据或模型 API。

## 1. 用户目标与实施原则

| 用户目标                 | 可交付结果                                                              | 不变的边界                                                          |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 易用性、布局与 UI 一致性 | 每页明确当前项目/集数、下一步、阻塞原因和恢复动作；统一状态词与交互反馈 | 复用已有制作总控、编辑器、批量页和体检，不以大改版作为前提          |
| 效率与效果               | 有效审核可复用；失败有分类；批量预检减少无效调用；模型与规则设置可追溯  | 不把降低审核要求当作提效；当前生产产物是文本及提示词，不是图片/视频 |
| 稳定持续工作             | 离页继续、暂停有边界、停止等待结算、重启显式恢复、提交可核验            | 不承诺网络请求恰好一次，也不自动恢复付费请求                        |
| 灵活推进与并行批量       | 先隔离独立项目，再开放有界并发；项目内依赖继续串行                      | 三入口依赖、剧情库存消耗、共享资产发布和人工编辑保护保持有效        |
| 规则参数与数据规范       | 先统一 8 参数，再做规则 profile、稳定 ID、版本及跨文件恢复协议          | 路径授权、数据完整性、合法评分、凭据保护和结构校验不可由用户关闭    |

优先顺序是：修正会误导操作或接受无效参数的缺口 → 建立执行/数据合同 → 开放两个独立项目的受控并发 → 再考虑同项目更细粒度并行。每个阶段都应能独立验收、回退；保留人工审核、冲突处理和任务幂等。

## 2. 基线事实与源码依据

下列证据编号供后文引用。路径均相对 `feicai-studio`；函数/类型名是定位锚点，后续实现变更时应重新核对。

| 编号 | 已核实事实及影响                                                                                                                                                                                | 源码定位                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01  | 主进程惰性持有一个 `PipelineStateMachine` 和一个 `BatchQueue`；独立 workflow 每次建 runner，但仍共用全局租约。不能只把租约换成 Map 就放开并发                                                   | [pipeline-runtime-service.ts](../src/main/services/pipeline-runtime-service.ts)：`getPipelineRuntime`、`getWorkflowRunnerRuntime`、`getBatchQueueRuntime`                                                                                                                                                                                                                                                                               |
| E02  | `ExecutionLease` 只有一个模块级 `active`，同步获取先于异步工作；暂停持有租约，停止 abort 后等待 settled，关闭拒绝新任务；应用启动先获取单实例锁                                                 | [batch-execution-lease.ts](../src/main/services/batch-execution-lease.ts)：`acquireExecutionLease`、`shutdownExecution`；[index.ts](../src/main/index.ts)：`requestSingleInstanceLock`                                                                                                                                                                                                                                                  |
| E03  | 引擎有可变 context、provider、项目设置、持久化对象、controller、runId 和 activeTask；设置模型和重复启动会拒绝活动任务。服务按次读取默认文本模型及项目设置                                       | [state-machine.ts](../src/main/engine/state-machine.ts)：类字段、`setProvider`、`start`；[pipeline-service.ts](../src/main/services/pipeline-service.ts)：`configurePipelineEngine`、`launchPipeline`、`buildWorkflowStepParams`                                                                                                                                                                                                        |
| E04  | 批队列是一个项目的一份 state，以 cursor 串行遍历任务；`full` 串行导演→服化道→分镜。任务持有 initialWaterline、steps、inFlight/operationId；运行态重载变 interrupted，需显式恢复                 | [batch-queue-service.ts](../src/main/services/batch-queue-service.ts)：`load`、`run`、`receipt`、`runPipelineTask`、`resume`；[batch.ts](../src/shared/batch.ts)：模式与水位解析                                                                                                                                                                                                                                                        |
| E05  | 现有恢复按准确 operationId 匹配正文标记或阶段快照，并验证通过审核仍有效；不能把“文件存在”视为成功。已记录的 steps 可以复用；没有通用跨文件事务日志                                              | [batch-queue-recovery.ts](../src/main/services/batch-queue-recovery.ts)：`recoverBatchCommit`；[batch-queue-recovery.test.ts](../src/main/services/batch-queue-recovery.test.ts)                                                                                                                                                                                                                                                        |
| E06  | 流水线事件广播给所有窗口；renderer 只有一个当前 context，日志、流和审核按 runId 过滤；批 store 也只有一个 snapshot，以 updatedAt 防旧快照覆盖。适合当前单执行，未形成多任务订阅协议             | [pipeline-runtime-service.ts](../src/main/services/pipeline-runtime-service.ts)：`forwardToRenderer`；[pipelineStore.ts](../src/renderer/stores/pipelineStore.ts)：`setupEventListeners`；[batchStore.ts](../src/renderer/stores/batchStore.ts)：`accept`                                                                                                                                                                               |
| E07  | 项目、文件、素材等外部变更用 mutation 租约；导出和数据管理也共用互斥。数据恢复和凭据清理不能简单降为项目锁                                                                                      | [mutation-handler.ts](../src/main/ipc/mutation-handler.ts)；[register.ts](../src/main/ipc/register.ts)；[export-handlers.ts](../src/main/ipc/export-handlers.ts)；[data-management-handlers.ts](../src/main/ipc/data-management-handlers.ts)                                                                                                                                                                                            |
| E08  | 剧情审核通过发布批次库存，剧审通过把本集未用条目标记已用；批次按标题替换并保持已有消耗状态。服化道通过会更新项目共享角色/场景库及本集 references 快照                                           | [workflow-engine.ts](../src/main/workflow/workflow-engine.ts)：`reviewStage`；[plot-breakdown-store.ts](../src/main/project/plot-breakdown-store.ts)：`appendGeneratedStoryToProjectPlotBreakdown`、`markProjectPlotBreakdownEpisodeStatus`；[art-output-merger.ts](../src/main/engine/art-output-merger.ts)：`parseAndMerge`                                                                                                           |
| E09  | 审核绑定正文和相关上游/有效设置的 hash，含依赖 schema v2；相邻剧本、角色稿、共享素材等变化可能使审核失效。发布服化道快照用于区分自身发布与后续修改                                              | [artifact-provenance.ts](../src/main/engine/artifact-provenance.ts)：`captureReviewProvenance`、`isReviewCurrent`；[artifact-provenance.test.ts](../src/main/engine/artifact-provenance.test.ts)；[art-output-merger.ts](../src/main/engine/art-output-merger.ts)：`readArtReference`                                                                                                                                                   |
| E10  | 文件写入按路径排队，临时文件 fsync→rename→目录 fsync，保留有效 .bak；有 compare-and-write。项目状态按路径读/合并/写。单文件原子性不等于跨正文、库存、状态、索引和队列的原子提交                 | [atomic-file.ts](../src/main/io/atomic-file.ts)：`enqueue`、`commit`、`atomicCompareAndWriteFile`；[project-state.ts](../src/main/engine/project-state.ts)：`mutateEpisode`                                                                                                                                                                                                                                                             |
| E11  | SQLite 单连接、WAL、外键开启，迁移受 user_version 管理；项目/集索引有稳定 ID 和唯一集号约束。扫描同步更新已有集而非重建所有 ID。配置文件与 config_json 分步写入                                 | [database.ts](../src/main/db/database.ts)；[migrations.ts](../src/main/db/migrations.ts)；[schema.ts](../src/main/db/schema.ts)；[episode-sync-repository.ts](../src/main/db/episode-sync-repository.ts)；[queries.ts](../src/main/db/queries.ts)：`createProject`、`updateProject`                                                                                                                                                     |
| E12  | Markdown 资产解析只取名称/正文/元数据；`loadCharacters`、`loadScenes` 每次给对象新 UUID，发布以规范化名称合并，提示词引用解析主要给出名称/类型/标签。因此类型里的 id 尚不是跨读取稳定的资产身份 | [asset-manager.ts](../src/main/asset/asset-manager.ts)；[markdown-parser.ts](../src/main/asset/markdown-parser.ts)；[art-output-merger.ts](../src/main/engine/art-output-merger.ts)：`stableName`；[reference-tracker.ts](../src/main/asset/reference-tracker.ts)                                                                                                                                                                       |
| E13  | RequestScope 有总时限、首包/空闲超时和取消；响应大小有限制。HTTP 错误目前主要转成安全文案；OpenAI 有一次特定不支持参数的兼容重试，没有统一配额调度器                                            | [request-transport.ts](../src/main/llm/request-transport.ts)：`RequestScope`、`assertResponseOK`；[openai-provider.ts](../src/main/llm/openai-provider.ts)：兼容重试；[types.ts](../src/main/llm/types.ts)：`BaseLLMProvider`                                                                                                                                                                                                           |
| E14  | 默认模型按 category 选择，生产服务使用默认 llm；图片有连接生成测试、视频仅记录。接口/模型存在 token 与协议设置，但没有可据此推断的统一供应商并发额度                                            | [llm-config-repository.ts](../src/main/db/llm-config-repository.ts)：`getDefaultLLMConfig`；[openai-provider.ts](../src/main/llm/openai-provider.ts)：`testConnection`；[pipeline-service.ts](../src/main/services/pipeline-service.ts)                                                                                                                                                                                                 |
| E15  | PipelineSettings 有 8 个字段；基线主进程仅做字段白名单及有限非负数校验，UI 另有数值约束，服务读取配置错误会回退默认值。规则语义分散，需统一合同                                                 | [types.ts](../src/shared/types.ts)：`PipelineSettings`、`DEFAULT_PIPELINE_SETTINGS`；[input-validation.ts](../src/main/security/input-validation.ts)：`assertProjectConfig`；[ProjectPipelineSettingsPanel.tsx](../src/renderer/components/project/ProjectPipelineSettingsPanel.tsx)；[pipeline-service.ts](../src/main/services/pipeline-service.ts)：`loadPipelineSettings`                                                           |
| E16  | 剧本内容硬规则除字数外仍固定场景 3–4、动作 25–40、对白 15–25、段落 9–12、结尾【卡黑】；标记为 minor 的问题也会使硬校验不通过。统一 8 参数不等于完成规则可配置                                   | [script-quality.ts](../src/shared/script-quality.ts)：`validateScriptHardRules`；[workflow-engine.ts](../src/main/workflow/workflow-engine.ts)：剧审硬校验分支                                                                                                                                                                                                                                                                          |
| E17  | 制作页已有总控、完整链折叠、日志与集导航；next-card 选择优先前期卡。侧栏平铺多个编辑入口，pipeline 链接从全局 context 取集数而未在此核验所属项目；批量页直接使用单队列快照和流水线日志          | [PipelinePage.tsx](../src/renderer/pages/PipelinePage.tsx)；[usePipelinePageController.ts](../src/renderer/hooks/usePipelinePageController.ts)：`pickNextWorkflowCard`；[Sidebar.tsx](../src/renderer/components/layout/Sidebar.tsx)：`pipelineEp`；[BatchPage.tsx](../src/renderer/pages/BatchPage.tsx)                                                                                                                                |
| E18  | 草稿按路径保存在 localStorage，设置另存本地；主进程状态读入口会重验审核并标记 stale/interrupted。项目体检已有 dryRun 和修复预览，备份有清单校验                                                 | [documentDraftStore.ts](../src/renderer/stores/documentDraftStore.ts)；[settingsStore.ts](../src/renderer/stores/settingsStore.ts)；[project-state-service.ts](../src/main/services/project-state-service.ts)：`getProjectPipelineState`；[ProjectHealthPage.tsx](../src/renderer/pages/ProjectHealthPage.tsx)；[project-repair.ts](../src/main/project/project-repair.ts)；[project-backup.ts](../src/main/services/project-backup.ts) |

## 3. 分期、优先级与独立任务边界

P0 指现有操作正确性缺口或新并发上线前必须关闭的风险；P1 指复用基础；P2 指新增能力。未开放并发时，潜在竞态不是“已经发生的数据损坏”。下表均为计划，完成状态以相应提交及验收为准。

| 阶段/优先级           | 独立任务、交付范围                                                                                                     | 依赖与退出条件                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 / P0，正在实现     | 制作总控入口适配、下一步与阻塞状态指引；小说/剧情/剧本入口只展示适用要求，区分独立动作、自动段、审核和导出             | 验收三入口的空白/就绪/审核失败或失效/运行/暂停/停止中/已完成状态；不会把生成文件等同审核通过；不扩大成导航重做                                       |
| A2 / P0，正在实现     | 现有 8 参数共享默认值、边界、交叉校验、归一化与可理解提示；UI/IPC/配置读取/实际执行使用同一合同                        | maxRetries、passScore、llmTimeoutSec、durationMin/Max、singlePromptMax、scriptWordCountMin/Max；边界矩阵及真实调用参数验收；不宣称其他硬规则已可配置 |
| A3 / P0，后续小修     | 项目切换与队列归属校验：侧栏不得携带其他项目集数，批量页明确当前队列所属项目；无关项目只能查看并导航到任务，不误发控制 | 基于 E17，先补两个项目的回归用例，再做最小修复；与 A1 合并后核对边界，避免重复改同一 hook                                                            |
| B1 / P1，最高优先后续 | 执行上下文、任务身份、事件信封和定向控制接口；每次运行独立实例，仍保留全局并发 1                                       | A1/A2 合并后适配；见第 5 节第一切片。旧单执行行为与三入口集成必须通过                                                                                |
| B2 / P1               | 版本化任务/提交记录与跨文件恢复；先覆盖剧情发布/消耗、服化道发布，再覆盖配置文件+索引更新                              | 依赖 B1 的身份和 A2 的有效设置；故障注入逐提交点证明幂等、冲突不覆盖；保持旧项目可读                                                                 |
| B3 / P1               | 供应商请求额度、错误分类、取消式退避、任务背压和监测；默认仍为 1                                                       | 与 B2 可并行开发，接口基于 B1；假时钟和受控 provider 验证额度、重试上限、取消与公平性                                                                |
| C1 / P2，受控并发     | 项目资源锁+全局维护屏障；持久化多项目任务列表；独立项目最大并发 2 的可选模式，默认 1                                   | B1–B3 验收后才开放；项目内始终串行；通过第 8 节竞态矩阵和临时数据 Electron 场景                                                                      |
| D1 / P1，可独立推进   | 资产稳定 ID/版本和只读数据体检；按需迁移而非重写正文                                                                   | 先建兼容读取、冲突预览，再显式迁移；受 B2 提交协议保护；不能凭同名自动合并冲突资产                                                                   |
| D2 / P2               | 版本化内容规则 profile、批任务优先级/计划编辑、导航分组与共享交互状态                                                  | A2 合同稳定后再扩展；规则修改影响范围可预览；保留人工决策；不依赖同项目并行                                                                          |
| E / P2，暂不承诺      | 同项目无共享写入阶段的并行探索                                                                                         | 依赖稳定资产版本、输入快照、依赖图与库存预留；另开评估任务，通过证据决定是否值得实现                                                                 |

建议最先交付的三项是 **A1、A2、B1**：先让用户知道下一步、让设置真实一致，再建立可以安全扩展的运行边界。B2/B3 是并发放量的必需条件，不是上线后再补的稳定性优化。

## 4. 并发边界与调度设计

### 4.1 哪些可以并行

| 操作组合                                     | 第一版策略                               | 原因与后续条件                                                                                         |
| -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 两个独立、无重叠目录的项目制作               | C1 允许，上限 2，还受全局/供应商额度限制 | provider、引擎、状态、输出与事件都要隔离；注册 ID 不同不足以证明目录独立（E01–E03、E07）               |
| 同项目不同集                                 | 保持串行                                 | 集间上下文、共享资产、库存及 project-state 文件共同参与；并行生成也可能改变下一集的审核输入（E08–E10） |
| 同集导演→服化道→分镜，生成→对应审核          | 严格依赖串行                             | 通过审核及当前输入有效性是后续条件；不能用 Promise.all 绕过依赖（E04、E09）                            |
| 剧情生成/审核发布与剧本生成/审核消耗         | 同项目串行                               | nextBatchNumber、水位、批次替换和未用→已用状态是共享数据；将来需库存预留与提交协议（E04、E08）         |
| 角色设计与服化道/分镜                        | 同项目串行；角色仍是可选独立动作         | 角色稿参与视觉上下文和审核指纹，不是无依赖的额外按钮（E09）                                            |
| 项目 A 制作，项目 B 编辑/导出/项目备份       | 锁改造后允许                             | B 的导出/备份持有一致性读保护；读文件存在不保证读到了同一提交版本（E07、E10）                          |
| 同项目手工保存、资产修改、目录迁移与制作     | 拒绝或排队，给出占用者及下一步           | 在途模型不能覆盖后来保存的稿件；暂停也不释放项目占用（E02、E07）                                       |
| 状态查看、日志查看、离页                     | 允许                                     | UI 查询不持有制作生命周期；展示最后已提交快照，可标记有待提交变更（E04、E18）                          |
| 数据库恢复、全局迁移、清理凭据、全局重建索引 | 全局维护屏障                             | 影响连接、身份或所有运行配置；先停止准入，等待相关任务结算，不强行释放锁（E07、E11）                   |

全局单实例锁继续保留；本路线是一个主进程内的异步任务并发，不是多 Electron 实例共享目录写入。

### 4.2 运行上下文与资源锁

建议建立 `RunContext`（新设计）：`taskId / runId / operationId / attemptId / projectId / canonicalRoot / episodeNum / stage`、有效设置与版本、模型配置非敏感快照、输入清单、独立 provider/engine/AbortController/persistence/event sink。模型凭据只在主进程通过受保护引用取得，不写入任务 JSON、快照或日志。设置在准入时冻结；用户改默认模型只影响新任务，在途任务不切模型（E03、E14）。

- `taskId`：用户任务的持久身份；`runId`：每次启动/恢复的运行身份；`operationId`：一个逻辑子步骤跨恢复不变；`attemptId`：每次网络尝试单独标识。当前 launch 会把 operationId 用作 runId，迁移要显式分开，不能假定现有字段已经有这些语义（E03–E05）。
- 锁键是经过现有授权与别名规范化的项目根目录，并绑定项目 ID。拒绝同根的重复身份和父子目录重叠的并发写入；保持现有符号链接拒绝和路径内约束。未来如果支持外部共享素材仓，要新增仓库锁，第一版不引入。
- 第一版每项目一个排他制作锁，涵盖生成、审核、发布、状态提交、手工变更和项目修复；只读浏览不占制作锁。不能仅按集号锁，因为同项目集之间存在库存和素材写冲突。
- 全局维护屏障先阻止新任务准入，允许在途提交结算；可取消任务由用户停止后等待结算。暂停任务不能自动抢占：提示“请恢复完成或停止后再维护”。屏障等待期间也要能取消维护请求，不能卡死 UI。
- 遵守固定顺序：准入许可→项目锁→请求槽位→短时提交锁；等待项目锁时不占供应商槽位，网络等待时不持 SQLite 事务。多项目操作按规范路径排序取锁；禁止嵌套子步骤重新获取外层锁，传递不可伪造的内部执行 token。
- 初始版本保持数据库维护、备份、凭据清理为全局操作；局部索引重建与项目备份缩小到项目锁，须另行证明不会更改全局缓存或在途快照。同步扫描虽是“读项目”，其索引写入也要检查扫描版本，避免旧扫描提交盖过新状态（E11）。

这不是把 `active` 换为 `Map<projectId, lease>`：共享 pipeline、单队列 state、全局 pause/abort、单 store、全局忙碌判断都需要一起改变。特别是 `getProjectPipelineState` 目前以“存在任意租约”判断 running 是否 interrupted，多项目后必须按 run 的所属项目和存活状态判断（E18）。

### 4.3 请求额度、背压与重试

基于 E13–E14，在生产调用入口统一调度，避免每个 provider 自行增加重试造成乘法放大：

| 层级         | 建议合同                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 总容量       | 默认活跃项目数 1，C1 可选 2；每项目 1；待处理任务设硬上限，先沿用现有单队列最多 10000 的保护思想，明确全局上限后才接受持久化入队                                                   |
| 供应商额度   | 按端点+账户引用分桶，模型可设子额度；不能仅按配置 ID 分桶，否则重复配置绕过限流。支持最大在途数、RPM、可选 TPM；无供应商能力数据时保守为 1，不能宣称探测得到真实额度               |
| token 与费用 | 用输入估算+输出上限预留额度，实际 usage 可获得时结算；不可获得时显示未知，不伪报精确成本。开始前显示项目/集数/阶段、模型、审核重做预算和可能费用                                   |
| 重试分类     | 429 按有上限的 Retry-After/指数退避加抖动；网络瞬时错误、部分 5xx 可有限重试；401/403、无效参数、解析结构错误、输入冲突、路径/数据校验失败不盲重试。取消是终止原因，不计为普通失败 |
| 两类重试预算 | `maxRetries` 继续表示内容审核后的重做次数；传输重试是独立受限预算，不混用该字段。OpenAI 现有一次参数兼容重试纳入请求总预算；保持总时限覆盖内部尝试                                 |
| 背压         | 请求退避释放网络槽位，保留任务归属；等待中的请求可取消，队列不无限派发 Promise；按项目轮转，优先级不能让小项目永久饥饿                                                             |
| 恢复         | 请求已发出但未确认产物时标记“结果未知”，优先查本地提交；供应商明确支持幂等键才使用。不能因本地 operationId 存在就保证不重复计费                                                    |

上线前扩展安全错误类型，保存 code/status/retryAfter/requestId 等经过筛选的字段；不保存原始响应体、带凭据 URL 或提示词。产品文案区分“等待额度”“请求中”“审核未通过”“输入已变”“等待人工处理”，不把所有情况都归成错误重试。

### 4.4 事件隔离、控制与重启

新事件建议为 `{ protocolVersion, projectId, taskId, runId, episodeNum, stage, seq, type, payload }`。每 run 的 seq 单调递增，任务快照另有 revision；不以墙上时钟 updatedAt 作为唯一排序条件。状态、日志、stream、审核、错误、阶段结束全部带身份，不能只有日志过滤。

主进程维护权威任务表，renderer 按 taskId/runId 存储；切换项目只切视图，不取消后台任务。新订阅先拿带水位的快照，再接续增量；迟到/重复事件按 runId+seq 丢弃，缺口时重取快照。日志采用有界环形缓冲与流式文本节流，批量页只订阅可见任务摘要。多窗口都必须同样处理（E06）。

pause/resume/stop/retry 请求明确 taskId 和预期 runId，主进程核验所属项目、当前状态及版本。旧全局控制接口在容量 1 的兼容期映射到唯一任务；多任务时拒绝含糊控制。暂停发生在检查点，不承诺正在接收的网络立即停住；UI 可分“暂停请求中/已暂停”。停止立即取消网络，等待文件写入和提交结算后才释放项目锁；排队任务可直接取消，在途结果不能迟到后写入另一个 run。

C1 建议将任务元数据放入 SQLite 的 `tasks` 与 `task_steps` 表，正文和项目提交日志继续在文件中：tasks 保存身份、模式、输入快照引用、状态和 revision；task_steps 对 operationId 设唯一约束并保存收据、输出 hash、提交引用及失败分类。恢复旧 batch-queue.json 时先校验版本和 steps，在一次 DB 事务中导入，再将旧文件标为已迁移且只读；重复迁移按旧队列 ID 幂等，任何时候只能有一个来源可被调度。数据库备份恢复后的活动任务一律转 interrupted，重新验证项目身份与产物，不直接续跑。此表迁移属于 C1 独立提交，不能夹进 B1 的实例隔离切片。

重启后先做版本检查和提交恢复，再列出 interrupted/结果未知任务，用户显式选择恢复或结束。每次恢复获得新 runId；只复用通过 operationId、输入 hash、输出 hash 校验的已提交步骤。输入变化时停在冲突状态，提供旧快照与当前版本差异，不能重放旧 PASS 或自动覆写新稿（E04–E05、E09）。

## 5. 第一项后续可交付切片：隔离运行，但仍只跑一个

B1 不是开放并发的宣传版本，交付应限定如下：

1. 在 shared 定义运行身份、事件信封、任务状态和定向控制合同；明确独立 workflow 动作也能被同一任务表观察。
2. 将 runtime 的可变 pipeline 变为按运行创建/销毁的实例；传入冻结的有效设置、模型配置、事件 sink 和 persistence。已有全局租约继续负责准入，容量硬限制 1。
3. 增加“列出当前任务/按 taskId 取快照/定向控制”接口和旧单任务适配；renderer 按身份接收数据，制作页保持当前体验，批量页展示归属。
4. 保留 batch steps/inFlight/operationId 恢复语义，不在这一切片同时替换队列存储格式；新字段缺失时显式适配 legacy 任务。
5. 做两项目顺序运行、旧事件迟到、旧 run 控制拒绝、停止等待结算、设置变更不串任务、workflow 与自动段互斥、三入口审核依赖回归。受控 provider 挂起第一个调用，验证第二个任务仍不能进入 provider。

验收门槛：任意事件/控制/输出归属错误为 0；活动实例结束后监听器和 controller 被释放；串行基线流程与已有恢复测试保持通过。回滚仅需继续使用旧 runtime 适配，不迁移正文、不更改人工审核历史。B1 内部可以预留注册表，但对外仍标注“单任务执行”。

## 6. 数据事实源与渐进标准

### 6.1 明确什么是正文、记录、索引与草稿

| 数据                                        | 当前事实源及行为                                                                                                                              | 渐进合同，不是基线现状                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 小说、剧情、剧本、导演/角色/服化道/分镜产物 | 项目目录中的正文，由 artifact registry/path resolver 定位；支持目录映射（E08–E10）                                                            | 正文继续保持 Markdown/文本可读可编辑；使用内容 hash 和版本清单绑定，不一次性搬入 SQLite                                                    |
| 项目配置                                    | project-config.json 与 SQLite config_json 并存；创建/更新先写文件后改库。pipeline 设置又直接读文件，项目上下文可来自注册记录（E03、E11、E15） | 文件为可携带配置的权威来源，DB 为已注册配置快照；注册/更新明确合并优先级，启动比较 revision/hash；冲突提示修复，不能任意一边静默覆盖另一边 |
| 剧情库存                                    | plot-breakdown Markdown 保存批次、条目身份、分集、未用/已用及人工规划（E08）                                                                  | 保留人工规划；增量记录谁以哪个 operationId 消耗哪些条目。将来同项目并行须先做 reservation→commit/release，不只读一次水位                   |
| 审核与运行状态                              | 审核 Markdown、project-state JSON 阶段/历史以及 SQLite reviews 等记录并存；读状态会结合文件及 hash 重验（E09、E18）                           | 当前有效性由正文+输入+规则版本与审核凭证决定，DB 状态标签不可授予 PASS；定义每类审核唯一持久凭证及其投影位置，历史只追加                   |
| SQLite                                      | 项目注册、集 ID、模型配置/加密凭据、历史记录，以及可重建的文件存在性/状态投影（E11）                                                          | 不是整库缓存：项目/集身份、凭据、历史不能随索引重建删除。只重建明确的派生字段；保存 projectionRevision 并能补写                            |
| 队列                                        | userData 下单个 batch-queue.json，含 cursor/steps/inFlight；不是 renderer state（E01、E04）                                                   | B2 加版本与校验，C1 再一次性导入 SQLite 任务表，只迁任务元数据。迁移后旧队列文件只读，不长期双写两套可调度队列                             |
| localStorage                                | 未保存草稿按路径、本机外观等设置；pipeline/batch store 是内存视图（E18、E06）                                                                 | 草稿只做恢复候选，带 baseHash/更新时间和 schemaVersion；不推进审核或自动保存正文。路径迁移需用户确认重新绑定；正文另有备份                 |

### 6.2 schema、ID、路径与版本

1. **不同版本不要混用。** 现有 `workflowVersion` 1/2 表示工作流兼容，SQLite `user_version` 管表结构，审核依赖有自己的 v2，服化道 references 有 version 1；不能把它们都当一个全局 schema。新增持久对象采用各自 `schemaVersion / revision / createdAt / updatedAt`，有运行时解码器和显式迁移链。未知更高版本拒绝写入并提示升级；缺字段的旧版本按 fixture 验证兼容（E09–E11）。
2. **身份独立于名称、路径和顺序。** 保持当前项目/集 DB ID；新增可携带 project identity 时建立本机注册映射，恢复成新项目不能误用原任务身份。episodeNum 仍是显示/定位序号，批次 batchNumber 不是集号。task/run/operation/attempt 采用第 4 节语义，不由 renderer 任意指定恢复收据（E04、E11）。
3. **资产稳定身份是单独迁移。** 先在项目内增加资产 manifest，保存 assetId、类型、displayName、aliases、revision、contentHash、相对产物路径、来源集/operationId；Markdown 继续是正文。以后读取不再生成临时 UUID，重命名不改 assetId，提示词引用绑定 assetId+revision，保留标签用于展示。旧文件仅在名称唯一且内容匹配时自动建立映射；同名异物、拆分/合并、手工复制一律给预览和冲突列表，不能丢失人工参考图（E12）。
4. **路径必须可携带也必须重新授权。** manifest/任务持久记录优先存 artifactId+项目内相对路径；运行时才解析到规范化根目录，并继续检查注册身份、目录映射、穿越及符号链接。绝对路径仅为本机定位信息，恢复后不能直接信任。路径大小写和 Unicode 规范化用于冲突检查，不擅自改名；通过 macOS/大小写敏感临时目录 fixture 验证（E10–E11，现有 [access-control.ts](../src/main/security/access-control.ts)、[path-resolver.ts](../src/shared/path-resolver.ts)）。
5. **输入快照包括规则。** 在任务准入时记录有效 8 参数、入口/目录映射、模型非敏感配置、技能模板版本/hash、ruleProfileId/version、上游产物及资产版本、原始内容 hash。审核提交前再次检查输入和目标 expected hash；hash 相同可复用，真实改变则失效。保持现有“缺省值与显式默认值等价”、operation 标记不改变正文审核 hash 的语义（E09）。

先覆盖任务、项目配置、project-state 与资产 manifest 的结构校验，不要求立即为所有 Markdown 定义完整 AST。结构校验失败与“正文未通过内容规则”分开报告，前者不应诱发付费模型重试。

### 6.3 写入协议与跨文件提交恢复

现有 `.bak`、按路径排队和项目状态读合并需要保留；它们不能解决“库存已消费但审核收据尚未写”“两个共享素材文件只写完一个”“配置文件成功而 DB 更新失败”的整个提交窗口（E08、E10–E11）。B2 建议以少量项目内提交日志扩展，而不是把正文迁库：

1. 调用模型前先持久化逻辑 operation 身份及输入快照，状态为 intent；网络重试沿用 operationId、另分配 attemptId。B2 继续用现有全局租约保护项目，C1 才替换成项目锁，不能提前缩小互斥范围。
2. 请求结束先保存候选产物，不立即标为完成。审核通过后，将正文、库存/资产变更、审核凭证、状态更新纳入同一逻辑提交清单，再写 `prepared` 记录：schemaVersion、operationId、输入版本、目标相对路径、每文件 expectedHash/newHash、暂存文件清单、索引投影计划。暂存目录位于项目内受授权路径，不含密钥或外部任意路径；核对 expectedHash 发现外部编辑冲突即停止，不以“最后写入者获胜”处理。
3. 提交过程用现有原子替换逐文件安装，并记录可恢复进度。文件全部核验后写 committed marker；再幂等更新 SQLite 投影，最后确认队列 receipt。完成标记以可验证的提交为准，不以 IPC 返回时刻或文件存在为准。
4. 崩溃恢复在接纳新制作前扫描未完成提交：旧 hash 表示尚未安装，新 hash 表示已经安装，可继续；两者都不匹配则进入 needs_attention，保留原稿与暂存供人工选择。部分提交优先根据清单前滚；无冲突且有完整原版本时才允许显式回退，禁止无条件覆盖外部新编辑。
5. committed 但索引/队列未确认时只补投影与收据，不重新调用模型、不再次消费剧情；projection 完成以 operationId 唯一性约束幂等。日志裁剪仅在提交、队列确认和备份保留条件均满足后进行。

该方案提供可恢复的逻辑提交，不宣称多个文件与 SQLite 在同一物理事务内原子可见。正常 UI 查询须通过保留的已提交快照及 revision 指针读取，不能直接将正在安装的文件投影为已完成；外部编辑器仍可能看到安装中的文件，因此备份/导出需项目一致性保护，恢复时必须验证 hash。网络端“已计费但本地未收到结果”的窗口不能由本地提交日志消除。

B2 首批仅覆盖剧情审核发布/剧审消费和服化道发布三种共享写入，随后补配置文件+DB。其它文件继续使用当前协议，文档和 UI 标出恢复覆盖范围，避免宣称通用事务已经完成。

### 6.4 校验、修复与迁移入口

复用“项目体检”与“设置→数据管理”（E18），新增只读检查项：版本兼容、配置文件/DB hash 差异、未完成提交、队列引用缺失、资产 ID 重复/悬空引用、路径越界、输入过期、索引投影滞后。每项提供影响、证据文件、可执行下一步；诊断导出只放必要元数据，保持现有不泄露正文/路径/Key 的边界。

修复先 dryRun 列出将改哪些文件、是否影响审核与哪些任务，再执行用户选择的动作；原子写入/快照保护，完成后复检。不得把损坏数据静默初始化、把过期审核强改为通过，或用重建索引删除业务集/历史。恢复项目到新目录并重新注册，任务迁移只带已验证的历史，不能自动恢复原机器上的运行请求。

## 7. 产品、交互与规则路线

### 7.1 现有页面上做小步改进

推荐后续导航层级为 **项目 → 本集制作 → 批量任务 → 资产/审核 → 设置**。这是基于现有平铺侧栏、制作总控和批量页职责的建议（E17），先验证命名和分组，不删除既有编辑路由：原文、剧情、剧本可作为“本集制作”的上下文入口；项目体检放在项目操作中保持可达。小说入口显示库存/章节，剧情入口显示按集剧情，剧本入口直接指向剧审，不强迫用户补无关文件。

| 小步改进           | 复用位置与证据                                                                                                                                                                       | 可验收结果                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 下一步与阻塞指引   | A1 制作总控、workflow cards、EpisodeNav（E17）                                                                                                                                       | 同一状态只给一个明确主动作，附阻塞原因及可点开的缺失/过期产物；完整链保留展开；审核失败有“查看问题/修改/重做”                              |
| 状态与操作组件     | 已有 [EmptyState](../src/renderer/components/layout/EmptyState.tsx)、[LoadingSpinner](../src/renderer/components/layout/LoadingSpinner.tsx)、toastStore 和项目/批量页按钮（E17–E18） | 先统一加载、空数据、失败重试、等待额度、输入已变、执行/暂停/停止中、完成；禁用按钮说明原因；命令待处理防重复点击；键盘聚焦和非颜色提示可用 |
| 项目与任务归属     | Sidebar、BatchPage、单 snapshot store（E06、E17）                                                                                                                                    | 切换项目后不显示另一个项目的集数为当前集；任务行显示项目/集/阶段；查看后台任务不等于控制当前页面项目                                       |
| 参数可理解性       | A2 项目设置面板（E15）                                                                                                                                                               | 单位、允许范围、上下限关系、默认值、保存生效时间和影响说明一致；非法值在输入旁提示，主进程仍拒绝绕过 UI 的无效请求                         |
| 批任务预检         | MODE_MAP、水位解析与批量页（E04、E17）                                                                                                                                               | 开始前列出将运行/跳过/被阻塞的集及原因、实际模式范围、模型与审核重做预算；部分不可执行时用户可调整选择，不静默扩大任务范围                 |
| 人工确认与结果检查 | 现有体检预览、草稿冲突、审核及导出入口（E18、E09）                                                                                                                                   | 重新生成已有人工作品、恢复结果未知请求、改变队列范围、数据迁移有具体影响预览；日常无冲突继续不重复确认；导出只使用当前有效审核             |

### 7.2 从 8 参数到规则 profile

A2 只收敛现有 8 参数，不在其验收里夹带内容规则设计。后续 profile 需显式包含 `profileId/version`、适用入口/媒介、每条规则 code、级别和参数；默认 profile 复现现有规则，使旧项目行为有明确来源。技能提示词、硬校验、审核展示必须消费同一个有效 profile；修改某规则后显示受影响产物并要求重审，不把旧 PASS 重新绑定到新规则。

E16 中结尾标记、场景/动作/对白数量、段落数量属于内容生产规范，应后续允许在支持的 profile 中调整；“minor 也阻断”的当前行为要在迁移中明确选择兼容，不能只改标签造成无声放行。路径授权、ID/结构合法性、读写完整性、可信审核解析及安全错误处理属于底层约束，不提供关闭开关。现有跳过审核是人工动作记录，不得自动变成满足下游依赖的合法 PASS（参见 [state-machine-lifecycle.ts](../src/main/engine/state-machine-lifecycle.ts) 的 `performSkipReview` 与 E09 的依赖校验）。

质量衡量先用固定受控样本测量硬规则通过率、输入完整性、首次审核通过率和人工返工次数；真实模型效果评估需单独预算与用户确认。不能从 mock 测试通过推导生成质量提升，也不能承诺增加并发一定提速或降费。

## 8. 验证矩阵、指标与验收门槛

以下是**未来实现验收要求**，不是已运行的测试结果；不改写既有 [测试矩阵](testing-matrix.md)。沿用相应既有测试文件扩展真实行为覆盖，新能力可新建测试，禁止只检查内部 Map 大小就声称并发安全。

| 维度           | 必测场景                                                                                      | 通过条件与参考基础                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 入口/参数      | 小说、剧情、剧本 × 无输入/有效审核/过期/FAIL/INVALID；缺省、边界、NaN、上下限倒置、磁盘坏配置 | UI 和主进程判断一致；无效配置不发模型请求；使用 A1/A2 自己的验收以及 workflow-entry-flows、production-integration 测试    |
| 运行隔离       | A/B 项目以不同模型设置和输出哨兵交错返回，A 迟到事件在 B 已开启后抵达；多窗口、切页、重连     | 事件、审核、正文、取消信号串任务为 0；pipeline-runtime-service、pipelineStore、batchStore 测试扩展                        |
| 锁与维护       | 同项目重复启动、别名/重叠路径、手工保存、导出/备份、暂停中申请维护、停止中再次启动            | 不发生共享写覆盖；维护期间新任务不准入；结算前不释放锁；batch-execution-lease、access-control、导出/数据管理回归          |
| 调度与额度     | 全局 2、同账户 1；多个配置共享账户；RPM/TPM 等待、429/5xx/鉴权失败、退避时取消                | 上限从不超出；取消后等待者移除；无无限重试、无饥饿；在受控计时下验证 B1 容量仍为 1，C1 可真实重叠两个独立项目             |
| 共享数据       | 剧情批次重审/消耗重放、相邻剧本变更、角色/素材发布与手工编辑冲突                              | 库存最多消费一次、人工规划保持；审核过期准确；asset/provenance/plot-breakdown 既有测试加故障用例                          |
| 崩溃提交       | prepared 后、每个 rename 前后、库存后收据前、状态后队列前、DB 投影前后故障注入                | 重启可分类为未提交/可前滚/已提交/需人工；已提交不重复调用；无外部新稿被覆盖；batch-queue-recovery 与 atomic-file 测试扩展 |
| 版本/迁移      | 未版本化旧文件、损坏主文件和 .bak、高版本拒写、恢复新路径、重复资产名、DB/文件分歧            | 旧项目可读；未知高版本不破坏；迁移可预览和备份恢复；保持集 ID/历史；project-repair、migration、backup 回归                |
| 桌面与持续运行 | 临时 userData/项目、受控 provider，批量运行中切页/第二实例/关闭重开/恢复；流事件持续输出      | 主进程持有生命周期，单实例保持；恢复须显式；监听器/缓冲受界限约束；不得使用真实用户数据或付费 API 作为自动测试依赖        |

建议指标在实现前记录串行基线，再用同一 fixture、机器和 provider 延时比较：

- **正确性硬门槛**：归属错误、越界写入、提交重复消费、恢复覆盖人工内容、无效审核放行均为 0。任何一项失败禁止提高并发。
- **可恢复性**：提交协议枚举的每个故障点都有确定恢复结果；可核验已提交步骤重复模型调用为 0。对结果未知请求单列计数，不能藏入普通重试成功率。
- **有界性**：实际活跃项目数/请求数从不超上限，待处理队列不超配置；持续 1000 次受控短任务后存活监听器/活动上下文回到基线，日志/stream 缓冲保持规定上限。
- **效率**：记录每阶段排队、请求、审核、重做、提交耗时及 p50/p95。C1 在两项目等长、允许两个请求并行且无重试的受控网络等待样本中，总耗时目标 ≤ 串行基线的 70%；真实供应商限额不足时不要求该速度，仍要求正确性。
- **交互**：记录三入口从项目打开到正确下一步的点击数；A1 不增加原本可执行步骤的点击数，阻塞项均可一跳定位；定向控制在受控 IPC 中 1 秒内反馈“已接受/被拒绝”，结算进度另显示，不能伪报已停止。
- **质量/成本可见性**：首次有效审核通过率、内容重做次数、传输重试次数、未知计费请求数分别统计；没有供应商 usage 时费用显示未知。诊断指标仅记录必要身份与计数，不包含正文或密钥。

实现阶段沿用仓库要求的 lint、format:check、typecheck、test:coverage、build，并对运行态/数据改动追加临时数据 Electron 冒烟。文档提交只需格式与链接/差异校验，不声称替代上述实现验收。

## 9. 风险、迁移与回滚

| 风险                               | 上线前处理                                                                        | 回滚边界                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 放开项目锁但漏掉共享引擎或全局控制 | B1 在容量 1 完成所有入口隔离，C1 枚举 IPC 变更/维护入口；不依赖 renderer 禁用按钮 | 将调度容量降至 1，停止新准入并等待在途结算；保留新任务读能力，不强杀提交                                       |
| 文件/DB/队列升级导致旧版本误读     | 版本化解码、未知高版本拒写、迁移前备份、旧格式 fixtures；多任务存储采用单一权威源 | 不能让旧二进制直接打开新协议；安全回退需停止任务、验证提交清单、恢复升级前备份到独立目录，并明确升级后历史损失 |
| 外部编辑不受应用租约保护           | 输入及 expectedHash 复检、冲突保留、提交 journal；提示备份期间不要外部改文件      | 不能自动用 .bak 覆盖未知新内容；按用户选择恢复候选版本                                                         |
| 默认模型/凭据变更影响在途任务      | 模型有效快照，凭据引用受控；清理凭据走维护屏障                                    | 取消/结算旧任务后重配，不把新 Key 注入旧 run，不在快照中复制 Key                                               |
| 规则变更使历史产物大量过期         | 版本化 profile 和影响预览，A2 合并后复核有效默认值 hash；不更改旧审核身份         | 可为新任务选择旧 profile，但仍按当前输入核验，不能强制恢复 PASS                                                |
| 资产名称到 ID 的错误自动合并       | 首先只读扫描；唯一匹配才迁移，有歧义人工处理；保留别名与原稿                      | 迁移 manifest 和正文映射同批备份，保持旧名称读取兼容；不能丢参考图或变体关系                                   |

每期合并报告必须分别写“已实现、已验证、未验证”，标明测试是否使用真实 Electron/SQLite 或受控 provider。文档中的候选方案不应直接变成产品中的“已支持”说明。

## 10. 本文档验证入口

本次仅新增本文和 README 入口链接。协调者可运行工作区外的 `/tmp/feicai-optimization-roadmap-task3.mk`：

```bash
/usr/bin/make -f /tmp/feicai-optimization-roadmap-task3.mk verify
```

该 Makefile 固定本任务 worktree、Node PATH 和已有 Prettier 路径，只检查本文格式、本地引用及 Git 差异的空白错误，不安装依赖、不读取应用数据、不调用模型。README 只加链接；现有 README 的格式问题若被全文件检查发现，应与本次新增内容区分，不顺手修改历史内容。此临时入口不随 Git 提交；协调者合并后的生产验收使用其整合工作区现有命令。

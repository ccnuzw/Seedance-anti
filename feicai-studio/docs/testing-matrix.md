# FEICAI Studio 测试矩阵

本文档说明当前测试分层覆盖的主要风险，便于后续新增功能时快速判断应补哪一层测试。

## 1. 共享纯逻辑

- 目录：
  - `src/shared/**/*.test.ts`
  - `src/renderer/utils/**/*.test.ts`
  - `src/main/engine/output-parser.test.ts`
  - `src/main/engine/prompt-assembler.test.ts`
- 主要覆盖：
  - 路径解析、自定义目录映射
  - 状态映射、页面展示决策
  - 工作流动作结果分支
  - 批量执行结果判定
  - LLM 输出解析与 Prompt 拼装
  - 内置 Seedance 模板的标题时长、素材表角色/场景映射、重复引用去重；素材表在开头/中间/末尾或独立存在均不成为提示词卡片
- 主要防回归风险：
  - 状态语义漂移
  - 单阶段/全流程判定错误
  - 自定义目录配置未生效
  - Prompt 或解析规则悄悄变化

## 2. Renderer 动作层

- 目录：
  - `src/renderer/utils/editor-workflow-actions.test.ts`
  - `src/renderer/stores/documentDraftStore.test.ts`
- 主要覆盖：
  - 编辑页动作成功/失败/审核未通过分支
  - 单集同步、review feedback、toast、页面跳转
  - 草稿跨文件恢复、读请求乱序、保存中继续输入、磁盘 CAS 冲突及本地存储失败
- 主要防回归风险：
  - 页面动作分支不一致
  - 成功后漏同步/漏跳转
  - 页面离开/关闭导致未保存内容丢失

## 3. Renderer Store / 组件 / 页面决策

- 目录：
  - `src/renderer/stores/**/*.test.ts`
  - `src/renderer/components/**/*.test.ts`
  - `src/renderer/utils/pipeline-page-view.test.ts`
- 主要覆盖：
  - pipeline/project store 事件驱动更新
  - 控制栏、工作流面板按钮状态
  - 页面摘要、完成横幅、卡片动作推导
  - 跨项目切换清理集数、项目与集数原子发布、旧查询/同步结果隔离（含切走再返回同一项目）
- 主要防回归风险：
  - 页面状态展示失真
  - 按钮门槛错误
  - 事件流更新不完整

## 4. Main Service / IPC

- 目录：
  - `src/main/services/**/*.test.ts`
  - `src/main/ipc/**/*.test.ts`
- 主要覆盖：
  - 独立动作、自动段、项目/文件/素材变更及导出互斥，runId 隔离、停止等待、暂停门和批队列恢复
  - 三入口从真实 SQLite 项目登记、独立工作流 service 到自动流水线、素材及导出 IPC 的受控集成
  - 项目备份完整性、恢复新目录、数据库事务恢复
  - IPC 主框架身份、项目 ID/路径一致性、最终路径与符号链接拒绝、审核导出门禁
- 主要防回归风险：
  - 前后端状态约定漂移
  - 已提交任务在重启后重复调用模型
  - 凭据重新绑定、路径穿越、悬空链接和未审核内容导出

## 5. Main Engine / Workflow

- 目录：
  - `src/main/engine/**/*.test.ts`
  - `src/main/workflow/**/*.test.ts`
- 主要覆盖：
  - 状态机单阶段/整集完成行为
  - fail-closed 审核格式与两步审核合并，正文/上游 hash 失效
  - 设置默认值归一化、可选角色稿进入视觉上下文、素材发布不自失效、后续素材/角色变更阻断导出
  - 取消、首包/空闲/总超时、分包 SSE 与真实 reader 释放
  - 批次身份、剧情稳定 ID、重复审核幂等及审核后素材发布
  - workflow engine 的路径解析与产物落盘
- 主要防回归风险：
  - 单阶段误报整集完成
  - 审核结果合并错误
  - 产物落盘路径错误
  - 运行时异常处理不一致

## 6. 数据与同步

- 目录：
  - `src/main/db/**/*.test.ts`
  - `src/main/project-sync/**/*.test.ts`
- 主要覆盖：
  - 真实临时 SQLite 的空库/历史库/部分升级库、事务失败回滚、重复初始化、较高版本拒绝
  - 文件系统扫描
  - 计划集与发现集取并集，保留稳定实体及审核/引用/日志历史
  - 单集刷新、worker 合并/回收与有限章节元数据读取
- 主要防回归风险：
  - 删除产物误删业务集，或把存在的旧审核误判为通过
  - 自定义目录扫描失败
  - Episode 状态与磁盘产物不一致

## 补测试建议

- 改纯函数、映射、解析规则：优先补 shared / utils 测试。
- 改页面动作和跳转：优先补 renderer 动作层测试。
- 改 store 事件和展示状态：补 store 或页面决策测试。
- 改 IPC / service 契约：覆盖可观察权限、状态、边界与错误；不增加只断言转发参数或复制文案的测试。
- 改状态机、审核、落盘路径：补 main engine / workflow 测试。

## 本轮集成验收（2026-11-12）

本节是四项基础修复合并后的验收；下方较早记录仅保留历史证据，不代表本轮重新执行。环境为 macOS arm64，Node 26.12.1（`/opt/homebrew/bin/node`），现有 Electron 42.11.18 / Electron 内嵌 Node 24.19.0。复用已安装依赖，没有安装、重建 native 模块或执行 dev/postinstall，没有读取真实 userData/Key 或调用真实模型。

| 检查               | 本轮结果与证据                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工程基线           | `npm run lint`、`npm run format:check`、`npm run typecheck -- --force`、`npm run test:coverage`、`npm run build` 通过；79 个测试文件、614 项测试                                                                                                                                              |
| 三入口实际下游     | `src/main/services/production-integration.test.ts`：novel 生成/审剧情库存，story 审按集剧情，script 直接审导入剧本；均经独立剧审 service→导演单阶段→可选角色生成→服化道/分镜→审核→导出；使用自定义目录及仅部分设置，story/script 不伪造小说/库存                                              |
| 真实数据边界       | 集成测试用临时项目文件和真实磁盘 SQLite，执行真实迁移/项目查询/状态落盘；Node 下以 `node:sqlite` 适配驱动 API。provider、Electron sender/dialog/IPC 注册及模型配置查询受控；不覆盖项目创建 UI、worker 扫描或真实模型质量                                                                      |
| 审核与素材         | 自动发布后 director/art/storyboard 的凭据仍当前有效；素材 IPC 修改后导出拒绝且不打开保存对话框，恢复相同正文后允许导出，再改角色稿即阻断；默认/空/显式默认/不同键顺序设置指纹一致，真实 passScore 等设置改变仍失效                                                                            |
| 并发控制           | 受控 provider 暂停中调用素材变更 IPC 被拒绝；运行结束正常变更/导出，竞争租约中导出拒绝且不生成目标文件；另有 `ipc/register.test.ts`、`ipc/asset-handlers.test.ts`、批队列/数据管理/入口单实例回归                                                                                             |
| 解析一致性         | `src/shared/fixtures/controlled-production.ts` 填充仓库内置模板，主进程素材 IPC 与 renderer 解析测试使用相同输入：2 条提示词、16.5 秒、场景 @图片3/@图片4 识别正确；元数据位置变化不漏计首条，原始分段索引用于选择                                                                            |
| Native SQLite      | 用现有 Electron 的 `ELECTRON_RUN_AS_NODE=1` 执行 `src/main/db/database.test.ts`，7 项通过；直接使用已安装 `better-sqlite3`，覆盖旧库数据保留、部分升级、重复初始化、约束/索引和迁移回滚。此项是原生驱动回归，不等于 GUI 启动                                                                  |
| 实际桌面启动 smoke | `scripts/electron-migration-smoke.mjs`：临时 userData/sessionData/logs/crashDumps，构造缺少 category 的历史 llm_configs 表（无凭据），加载真实生产 main/preload/renderer；真实 IPC 返回空项目列表，版本/索引/完整性检查通过；第二实例退出且第一实例收到事件，随后正常退出。渲染网络请求受阻断 |

补充验收重点由本轮全量测试中的以下回归覆盖：

- `workflow/workflow-entry-flows.test.ts` 装配真实 builtin skills 后断言 prompt：novel 首次拆解/剧情审核允许尚无库存，剧本生成/审核才要求小说章节和本集绑定库存；story/script 不强制虚构小说与库存。provider 仍受控，不能据此推定真实模型遵循提示词。
- `ipc/register.test.ts`、`ipc/asset-handlers.test.ts`、`ipc/export-handlers.test.ts`、数据管理和租约回归覆盖制作与编辑/删除/导出/备份冲突，以及取消对话框不占租约。`ipc/export-handlers.test.ts`、`io/atomic-file.test.ts`、`services/project-service.test.ts` 验证公开读取使用只读备份回退，缺失/损坏/陈旧章节索引在公开查询期间不落盘，随后持锁扫描仍可更新。
- `engine/artifact-provenance.test.ts`、`ipc/export-handlers.test.ts` 验证角色、共享视觉资料、相邻剧本变更使对应凭据/导出失效；`engine/art-output-merger.test.ts` 验证 art 发布自身不误失效、两份共享文件中途取消后可重试，不把部分发布误识别为外部修改。
- 审核依赖 schema 已升级至 v2，历史审核即使正文未变也需重审；此版本号不是 SQLite 数据库版本。`full` 自动段仍为导演→服化道→分镜，不自动执行 `character`，角色设计为可选独立动作。

覆盖率由 Vitest v8 本轮实际加载的模块组成，未配置覆盖全部源码的 `coverage.include`；未加载页面、未执行分支及外部桌面行为不能由总比例推定。报告为 statements 81.91%（5115/6244）、branches 69.17%（3570/5161）、functions 83.05%（995/1198）、lines 83.72%（4852/5795），门槛分别为 63/49/67/63。分母可能包含加载到的 fixture/helper；mock 的 IPC/原生环境与上面的 Electron smoke 不计为全仓库或端到端覆盖率。

本轮集成发现并修复两处衔接问题：独立审核与自动段默认设置不同导致凭据误失效；提示词页面按“第一段是素材表”处理导致无表/表移位时漏计首条。旧格式审核指纹保守失效，需要重审；未通过忽略配置或素材变化放松门禁。

复验（已具备依赖，在 `feicai-studio` 下执行；不自动安装依赖）：

```bash
npm run lint && npm run format:check && npm run typecheck -- --force && npm run test:coverage && npm run build
node scripts/electron-migration-smoke.mjs
# macOS 已安装 Electron/native 模块的附加迁移回归
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ./node_modules/vitest/vitest.mjs run src/main/db/database.test.ts
```

`npm run build` 为编译构建，不是打包安装或发布验收。

未验证范围：真实服务商/付费 API、模型输出质量、完整桌面三入口点击制作及视觉交互、其他平台与打包安装、签名/公证/发布。未重新执行下方历史大项目性能测量、audit 或外部文档检查器。未解决的产品限制仍包括跨文件发布没有整体事务、角色/素材缺少正式版本模型，以及人工确认和跨集质量分析；本轮未扩展这些能力。

## 较早本地验收记录

使用临时项目与独立 Electron userData，不触碰真实项目或 API Key，不调用付费模型。Provider 协议回归使用受控网络响应；不能等同于真实服务商验收。

2026-11-12，在 macOS arm64、Electron 41.5.0 的隔离入口执行真实 SQLite 备份/事务恢复、完整项目备份/校验恢复及新项目注册；均通过。每集包含独立剧本及约 45 KB 的章节正文，表中为单次本地测量，不是服务承诺或 UI 延迟。

| 集数 | worker 首次全扫 ms | worker 重复全扫 ms | worker 单集 ms | 章节索引首次 ms | 章节索引重复 ms |
| ---- | -----------------: | -----------------: | -------------: | --------------: | --------------: |
| 30   |               23.9 |               36.9 |            0.9 |            17.8 |             2.6 |
| 100  |               68.5 |               69.3 |            1.1 |            22.4 |             6.6 |
| 1000 |              669.5 |              652.7 |            0.9 |           110.3 |            53.1 |

重复全扫仍需检查文件元数据；缓存并不消除每集路径验证。临时验收脚本在交付前移除，长期回归由上述测试承载。

### 较早修复回归（2026-11-12）

- `npm run typecheck`、`npm run lint`、`npm run test:coverage`、`npm run build` 本地通过；73 个测试文件、514 项测试通过，行覆盖率 81.22%，覆盖率门禁通过。
- 完整 `npm audit` 报告 0 个已知漏洞；该结果不代表不存在未知漏洞。
- 使用生产构建的 `file://` 页面及真实 preload/IPC 验证批量页刷新、设置中的数据管理入口，以及 1024×700 窗口下的布局。
- 实际按 1000→30→100 集项目切换：选集列表分别渲染 100、30、100 项；1000 集项目用 Enter 翻页后首项为 EP101，Space 选集更新 `aria-pressed`。未出现跨项目集数残留，浏览器错误记录为空。
- 跨项目切换中发现的旧集数残留已增加 6 项回归，覆盖切换清理、异步加载原子发布、迟到查询/同步及不存在的项目。
- 未调用外部付费模型，未生成实际图片或视频；上述本地验收不代替真实服务商及发布签名/打包验收。
- `npm run format:check` 通过；`check-docs.mjs --docs docs` 检查 2 份现有文档，0 个错误、0 个警告。项目未采用该检查器的功能编号体系，此结果只代表适用文档规则通过。

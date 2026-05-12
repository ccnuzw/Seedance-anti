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
- 主要防回归风险：
  - 状态语义漂移
  - 单阶段/全流程判定错误
  - 自定义目录配置未生效
  - Prompt 或解析规则悄悄变化

## 2. Renderer 动作层

- 目录：
  - `src/renderer/utils/editor-workflow-actions.test.ts`
  - `src/renderer/services/service-bridge.test.ts`
- 主要覆盖：
  - 编辑页动作成功/失败/审核未通过分支
  - 单集同步、review feedback、toast、页面跳转
  - 前端 service 到 `window.feicaiAPI` 的参数透传
- 主要防回归风险：
  - 页面动作分支不一致
  - 成功后漏同步/漏跳转
  - IPC 参数契约漂移

## 3. Renderer Store / 组件 / 页面决策

- 目录：
  - `src/renderer/stores/**/*.test.ts`
  - `src/renderer/components/**/*.test.ts`
  - `src/renderer/utils/pipeline-page-view.test.ts`
- 主要覆盖：
  - pipeline/project store 事件驱动更新
  - 控制栏、工作流面板按钮状态
  - 页面摘要、完成横幅、卡片动作推导
- 主要防回归风险：
  - 页面状态展示失真
  - 按钮门槛错误
  - 事件流更新不完整

## 4. Main Service / IPC

- 目录：
  - `src/main/services/**/*.test.ts`
  - `src/main/ipc/**/*.test.ts`
- 主要覆盖：
  - `launchPipeline` / `runWorkflowAction` 参数与返回状态
  - pipeline runtime 缓存
  - IPC 入口的受信路径校验与参数透传
- 主要防回归风险：
  - 前后端状态约定漂移
  - `startStage` / `singleStage` 丢失
  - 受信路径校验缺失

## 5. Main Engine / Workflow

- 目录：
  - `src/main/engine/**/*.test.ts`
  - `src/main/workflow/**/*.test.ts`
- 主要覆盖：
  - 状态机单阶段/整集完成行为
  - 审核引擎两步审核合并逻辑
  - 阶段执行器的中断/超时/错误行为
  - workflow runner 返回语义
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
  - 文件系统扫描
  - 数据库同步与幽灵 episode 清理
  - 单集状态刷新
- 主要防回归风险：
  - 删除文件后数据库残留
  - 自定义目录扫描失败
  - Episode 状态与磁盘产物不一致

## 补测试建议

- 改纯函数、映射、解析规则：优先补 shared / utils 测试。
- 改页面动作和跳转：优先补 renderer 动作层测试。
- 改 store 事件和展示状态：补 store 或页面决策测试。
- 改 IPC / service 契约：补 main service 或 renderer service-bridge 测试。
- 改状态机、审核、落盘路径：补 main engine / workflow 测试。

# 批次与自动化 QA

这份文档记录当前批次模块与自动化链路的工程校验入口。

## 推荐执行顺序

1. `npm run smoke:batch`
2. `npm run smoke:reports`
3. `npm run smoke:automation`
4. `npm run qa:batch`
5. `npm run verify`

## 覆盖范围

### `smoke:batch`
- 批次规划
- 模板覆盖阶段
- 串行/并行依赖链
- 定时批次时间解析
- 运行时队列入库与持久化恢复
- 诊断快照中的排队摘要与依赖/定时阻塞识别

说明：主进程集成烟测依赖本机可用的 `better-sqlite3` 原生绑定；若当前 Node/Electron ABI 不匹配，测试会自动跳过，并建议先重装或重编译原生依赖。

### `smoke:reports`
- 审计报告 Markdown 生成
- 任务闭环摘要 Markdown 生成
- 诊断快照 JSON 导出
- 自动化配置校验

### `smoke:automation`
- 自动化调度时间解析
- automation key 稳定性
- 配置归一化

## 运行稳定性与恢复层

当前任务中心和运行时管理器已经补充以下恢复能力：

- 应用启动后自动回收上次异常退出遗留的 `running` / `paused` 任务
- 孤儿运行任务会转入 `dead_letter`，保留原始 payload，允许后续重新入队
- 队列任务会做 payload 完整性校验；损坏任务不会继续卡在队列中
- 运行中的任务会周期性刷新 heartbeat，避免长任务被误判为卡死
- 任务中心支持手动触发一次“运行恢复巡检”，强制执行队列校正与死信回收

诊断关注点：

- `queueSummary.deadLetter`
- `recovery.deadLetterCount`
- `recovery.orphanedRunCount`
- `recovery.lastSweepAt`
- `recovery.lastSweepError`

## 可观测与成本层

当前任务中心、流水线页和运行时记录已经补充以下可观测能力：

- 每次 LLM 调用会记录阶段、调用相位、provider、model、耗时、成功/失败状态
- 能从 provider 读取 usage 时优先落真实 token；拿不到时回退到统一估算口径
- `pipeline_runs` 会聚合每个任务的 LLM 调用次数、Token、总耗时、预估成本、最近失败分类
- 任务详情页会展示逐次 LLM 调用明细，方便定位“执行阶段失败”还是“审核阶段失败”
- 诊断快照会带上全局 telemetry 汇总，便于导出排障和成本审计

诊断关注点：

- `telemetry.runCount`
- `telemetry.callCount`
- `telemetry.successCount`
- `telemetry.failureCount`
- `telemetry.totalTokens`
- `telemetry.estimatedCostUsd`
- `telemetry.lastCalledAt`

## 手工回归建议

在桌面端至少人工走一遍：

1. 项目页配置一个模板和一个每日计划
2. 批量页选择模板，确认预览区显示正确
3. 任务中心查看运行时诊断
4. 让一个批次完整结束，确认批量页出现“最近批次闭环摘要”，并在项目目录 `outputs/automation-reports/` 下生成闭环 Markdown
5. 在任务中心选中该批次任一任务，确认详情侧栏的闭环统计与批量页一致，并可再次导出闭环摘要
6. 在项目页确认“最近任务闭环”卡片能展示最近一次任务范围，并成功导出闭环摘要
7. 导出审计报告与诊断快照
8. 制造一次失败任务，确认 Toast/桌面通知表现正常
9. 人工插入或模拟一次异常退出后的运行任务，重启应用后确认任务进入死信，并可在任务中心重新入队
10. 在任务中心点击“运行恢复巡检”，确认诊断面板中的恢复统计更新
11. 启动一条真实任务，确认任务中心详情中出现 LLM 调用次数、Token、成本和最近模型
12. 人工制造一次模型超时或网络失败，确认任务详情中出现失败分类与具体失败调用
13. 导出闭环摘要 / 自动化审计报告 / 诊断快照，确认三处都包含 LLM telemetry 与成本字段

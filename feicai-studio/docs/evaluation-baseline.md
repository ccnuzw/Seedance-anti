# F06 调用记录与受控评测基线

本模块独立于生产引擎、数据库、Provider 热路径及恢复系统。它提供记录合同、显式 sink、汇总和固定样本比较 API；生产工作流采集留给 F03 后续串行接入。没有真实模型、网络或付费服务验证，也没有模型自评分。

## 接入 API

- `src/shared/generation-observation.ts`：`GenerationObservation`、`ObservationIdentity`、`AdoptionMeasurement` 及严格解析器。所有可序列化合同使用 `schemaVersion: 1`，未知版本、额外字段和不合法状态组合会拒绝。目标及输出均绑定对象和版本。
- `src/main/evaluation/observations.ts`：`observationIdentityFromRequest(envelope, descriptor, skill)` 复用现有 Provider 请求及能力检查，固定 project/task/run/operation、目标版本、连接修订、模型描述版本和 Skill 包版本/hash。没有 Skill 时必须传 `null`，不猜测版本。
- `observationFromProviderResult(context, result, outputs)` 直接投影现有 `ProviderResult`；`observationFromProviderError(context, error)` 复用 `LLMRequestError` / `TextProviderCallError` 的错误类别和部分用量。完成、截断、拒绝、不完整、未知保持区别。失败、取消和未知不能绑定已完成候选输出。
- `createObservationRecorder({ append })` 将严格解析后的安全快照交给调用者提供的持久化 sink。`record()` 串行化写入、检测本 session 内重复 attempt 和同一 operation 的身份变化；调用者或 sink 的后续对象修改不影响内部快照。append 拒绝会原样向上传递，不自动重试。sink 必须保证持久化唯一性及其自己的提交语义；若 append 已提交后才抛错，调用者必须先按 sink 的事实核实，不能据此重新生成。本模块的内存集合仅做 session 校验，不是任务事实源或恢复日志。
- `validateObservationSet(records)` 对完整记录集合做重复、身份、父子 generation/transport 和 job 关联检查。transport 可以先到达 recorder，但最终汇总不接受孤儿 transport。同一 operation 内身份固定；更换模型、Skill、目标版本或连接必须使用新的 execution/operation 身份。
- `summarizeObservations(records, adoptionMeasurements?)` 汇总已校验记录。transport 有独立 attemptId，并关联 generationAttemptId；submit/poll/download 的传输尝试不再记录生成用量，不增加生成次数或候选采用次数。

调用示例（持久化实现由调用者负责）：

```ts
const adapter = createTextCapabilityProvider(config, model, envelope.binding)
const identity = observationIdentityFromRequest(envelope, model, resolvedSkill)
const recorder = createObservationRecorder(existingObservationSink)
const result = await adapter.generate(request)
const outputs =
  result.kind === 'text' && result.completion === 'complete'
    ? [{ objectId: candidate.objectId, version: candidate.version }]
    : []
await recorder.record(
  observationFromProviderResult(
    { identity, attemptId: envelope.attemptId, startedAt, endedAt },
    result,
    outputs
  )
)
```

记录是一次调用在选定边界上的不可变观测，不是进度事件流。异步 job 的 `submitted` 只表示取得 job 身份，不表示远端完成、成功采用或免费。媒体调用方可以等待作业收敛后写一条带 jobId 的最终 generation 记录，并把提交/轮询/下载记录作为 transport 关联；不要将同一 generation 的提交和完成各写一条重复计费记录。job 恢复、后续状态纠正以及 durable 去重由未来调用方与既有事实源处理，本模块不会重提未知调用。

## 敏感信息与未知值

普通记录只允许应用管理的短身份引用、时间、类别、对象版本、完成状态及供应商数值用量。它不接受输入正文、输出正文、prompt、URL、凭据、堆栈、错误消息或自由格式 metadata。投影器丢弃结果正文、finishReason、供应商错误正文和请求消息；校验错误使用固定消息，不回显不受信任字段或值。身份引用应由调用者分配，不能把正文或密钥伪装成 ID。样本正文只存在于专用受控资源和离线评测输入中，不进入观测或评测报告。

供应商未返回的 token 数和费用保持未知；不会用文本长度推算 token，也不会用输入/输出 token 相加伪造 totalTokens。费用 `0` 是已报告的实际零，缺失不是零。用量报告提供 `knownSubtotal`、已报告数量和未知数量；部分 subtotal 不能称为完整总量。

账单和估算始终分开，按币种、供应商/连接/端点修订/模型身份分组；估算再按 priceVersion 分组。这里的价格来源只支持现有 ProviderUsage 中的 provider_reported，不额外制造价格表。无跨币种换算、无账单与估算总和，也不把估算当账单。取消仅确认本地 abort；远端取消与账单可保持未知。真实费用是否来自真实工作流必须由采集者另行证明；受控夹具中的数值不能被称为真实 API 费用。

采用测量必须另外传入按 project + 输出对象版本定位的 `AdoptionMeasurement`。相同输出版本经多个生成/传输尝试只计一个候选；重复决定、未知候选或跨项目引用被拒绝。缺少任何候选决定时整体采用率保持 `null`。完成成功本身不等于采用。返工分钟没有采集渠道，始终为 `null`。

## 受控样本与比较

`resources/evaluation/lantern-river.dataset.json` 是专为本仓库创作并以 CC0-1.0 分发的短篇《借来的灯》和连续两集《雾堤值夜》，未使用用户小说。标签覆盖关键事件、伤情与人物关系、铜钥匙/围巾流转、场景要求及严重审核漏检。

`annotation: authored_expectation` 表示样本作者事先编写的期望标签；它们承担人工标注的期望角色，不是实际人工评审结果，也不是模型判断。文风标签需要人工判定，另保留 `unlabelled` 样本项。未标注和待人工项均计为 unknown，不能当作通过。

两组 `candidate-v1.json` / `candidate-v2.json` 明确标为 `synthetic_fixture`，包含相同输入的合成候选、合成审核发现和固定调用记录。两组夹具固定了源文、标签和输入对象版本整体的规范化 SHA-256；即使只修改原文且忘记变更版本号，旧候选也会被拒绝。`controlledDatasetFingerprint` 可为明确更新的受控样本生成摘要。审核标签针对各集 source 中明确给出的“待改候选”缺陷；`detectedIssueIds` 是对此固定审核输入的合成发现，不是对修正后剧本文字重新进行真实审核。第二组仍故意漏检 `issue-key`。

`runControlledEvaluation(dataset, variant)` 严格解析、绑定候选与记录身份并输出独立指标：

- engineering：候选是否有合同有效、完整成功且正文非空的生成记录。无效合同直接拒绝运行；截断/失败/未知或空白正文不通过完整成功检查。记录的输入对象版本必须对应当前样本，不能把其他版本的调用混入比较。
- content：固定标签的 passed/failed/unknown，按类别计数；严重审核漏检单列。缺少完整响应时，对应内容项未知，严重漏检率也不以不完整分母报告。
- measurements：真实返工时间、真实采用率和真实费用，无测量均为 `null`。报告始终标注 `synthetic_controlled_only`、`realQualityValidated: false`。

`compareControlledVariants(dataset, before, after)` 对同一份解析后的输入重跑两个版本，报告包含输入 SHA-256 和按类失败数量差。样本、标签、版本或来源不匹配会拒绝；输入指纹包含原文及标签，不依赖 JSON 键顺序。报告不含原文或候选正文。

当前固定比较预期：两组 engineering 均为 3/3；关键事件失败 2→0、人物连续性失败 1→0、道具失败 3→0、严重审核漏检 2→1；两项文风判断保持 unknown。以上只是人工设定的合成缺陷被夹具检查识别，不能证明模型或 Skill 的真实质量提升。literal matcher 甚至会把“没有三次灯闪”匹配为包含期望短语；回归测试明确展示这一边界。开放语义、自然改写、实际审核效果和真实工作流质量都待 F03 接入后，用明确采集与人工评审另行验证。

## 本地复跑

从工作树根目录执行 `make -f /tmp/f06.mk verify`。交付时保留 `/tmp/f06.mk` 和 `/tmp/f06-verify.sh` 两个独立入口文件。它们设置 `/opt/homebrew/bin`，临时链接主工作区已有依赖到本树真实的 node_modules 目录，让缓存留在本树，禁止覆盖已有依赖目录；退出 trap 删除临时目录并原字节恢复本树两份 tsbuildinfo，不安装包或使用网络。

入口运行相关 Vitest（包含现有 Provider 适配器回归）、`npm run typecheck -- --force`、全树 `npm run lint`、本任务文件 Prettier 检查和 `git diff --check`。固定比较本身可用 `vitest run src/main/evaluation/controlled-evaluation.test.ts` 复跑；组合测试使用真正的现有 Provider/适配器实现，但 fetch 被本地固定 Response 替换，属于离线工程组合验证，不能称为真实 API 或真实模型验收。

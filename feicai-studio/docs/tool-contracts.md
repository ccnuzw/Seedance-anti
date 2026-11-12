# 工具合同与受控调用服务（F04）

`src/shared/tool-contracts.ts` 定义 v1 描述、调用、显式 grant、文件引用、待登记结果和安全收据，并复用 `PipelineRunIdentity` 的 project/task/run 字段及生产合同 `VersionRef`。所有 envelope 拒绝未知字段和未知版本；参数与数据必须是有界普通 JSON。工具参数 schema 使用现有 `Schema<T>`，由受信主进程注册，禁止从模型或外部输出构造校验器。

主进程消费顺序：

1. 创建 `ToolRegistry`；通过 `registerAssetInspectionTool(registry)` 显式注册内置资产引用校验器。测试可注册 `transport: 'test'` 的适配器。注册必须引用已登记的 schema ID/版本。当前只允许免费只读、项目文件范围工具；写入、计费、未知费用和空范围均拒绝注册。没有 shell、下载、网络或 MCP 适配器。
2. 创建 `ToolInvocationService({ registry, resolveRun })`。F05 负责提供受信的当前 project/task/run 归属查找，返回该项目已注册的真实根目录；无匹配返回 `null`。不得用请求携带的项目路径直接实现该函数。项目注册继续使用已有访问控制，工具服务不会自行注册根目录。
3. F05 从受信有效项目配置和任务快照生成 grant，并由主进程调用 `installGrant`；使用独立 grant ID，以 `revokeGrant` 撤销。grant 绑定精确工具版本、运行身份和目录。Skill 声明只能预检需求，模型文字只能作为数据，二者都不能调用这些配置 API。写入与计费字段必须显式填写，即使设置为 true，当前注册层也不提供对应适配器。
4. 调用 `invoke(invocation, abortSignal)`。reason 为固定业务原因码，避免自由正文进入收据。schema 校验后只记录参数顶层字段数，不保存字段名、正文、凭据、路径、摘要 hash 或异常文字。安全 ID 和运行标识必须由主进程生成；不要将用户正文放进 ID。调用 ID 在服务实例内禁止重复；实例内仅允许一个未结算的适配器。
5. `getReceipts()` 返回隔离副本，供后续任务记录接入；目前仅内存保存，无持久化。F05/T03 需要自行接入持久任务与配置快照。本模块没有 IPC、preload、工作流、engine、db 或生产调用入口。

内置工具 `builtin.inspect-asset-reference@1` 输入 `{ file: ToolFileReference }`，验证 `assets/` 内普通文件的项目身份、路径、字节数与 SHA-256；grant 目录与描述目录取交集。使用现有 `assertRegisteredProjectRoot`、`assertPathWithinProject`、`assertProjectFileReadAllowed`，拒绝文件及父目录符号链接、悬空链接和跨项目引用。单文件最大 64 MiB，分块读取，不解析媒体尺寸或声明媒体技术审核通过。媒体类型、尺寸和版本存在性仍需后续产物登记服务校验。`target` 仅复用版本引用结构并验证项目身份，不声称对象/修订已登记。

适配器必须通过 `inputResources` 枚举输入文件引用，不能把隐藏路径埋入自由文本后执行 I/O。实际读取通过 `context.inspectFile` 再次验证 grant、身份和文件。受信适配器自身是执行边界，普通 JavaScript 适配器不构成沙箱。禁止注册从项目导入或模型生成的代码。同步文件操作会在操作前后校验路径及文件元数据；服务沿用现有桌面访问控制，并不提供抵御另一个本地恶意进程并发替换父目录的 OS 沙箱。

适配器输出先经过严格结果 envelope、输出 schema、文件范围/元数据校验。`resources` 只有 `disposition: 'pending-registration'`；data 中的 PASS 或指令文字同样只是数据，不产生审核、候选采用或权限。结果不能直接发布到生产事实库。

超时/取消会发出 AbortSignal 并立即返回本地收据，但不证明远端执行结束。已启动调用为 `execution: 'unknown'`，迟到返回被丢弃，不追加成功记录；容量直到适配器 promise 实际结算才释放。适配器异常、无效响应也不会被视为安全重试。当前所有收据 `retryAllowed: false`，能力字段描述不能替代未来恢复/重试决策。已取消且尚未启动的调用记录 `not-started`。不可中断的同步 JS/文件操作无法被中途抢占；服务会在接收结果和完成输出校验时检查单调时钟截止时间，超时结果不会发布。未来外部适配必须提供自己的 I/O deadline。

独立复验（使用主工作区已有依赖，不安装/重建依赖、不访问 userData）：

```sh
M1_SHARED_NODE_MODULES=/Users/apple/Progame/Seedance-anti/feicai-studio/node_modules \
  make -C feicai-studio/src/main/tools verify
```

入口复用已有 `scripts/m1-verify.py` 的临时依赖链接、独立本地缓存、`/opt/homebrew/bin` PATH、finally 清理及 tsbuildinfo 原字节恢复；F04 检查顺序为 force typecheck、全量 lint、变更 Prettier、工具/路径 Vitest、diff check。不会执行依赖安装或连接服务。

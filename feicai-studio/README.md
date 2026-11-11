# FEICAI Studio

FEICAI Studio 是一个基于 Electron、React 和 TypeScript 的影视短剧制作工作台，覆盖项目导入、剧本生产、审核、资产整理与自动化流水线执行。

## 环境要求

- Node.js 22+
- npm 10+
- macOS 优先；如在其他平台运行，需确认 Electron 原生依赖可正常安装

## 快速开始

```bash
npm ci
npm run dev
```

首次安装会自动执行 `postinstall`，同步 Electron 与原生依赖运行时。

如果首次安装在 Electron 二进制下载阶段超时，可通过镜像重新安装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci
npm run dev
```

如果依赖包已完整安装、仅缺少 Electron 运行时，可执行
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run sync:runtime`。
该命令同时将 `better-sqlite3` 原生模块与 Electron 版本同步。

## 常用命令

```bash
npm run dev
npm run build
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:coverage
```

`npm run typecheck` 使用 TypeScript build 模式检查主进程、preload、渲染进程及共享代码的项目引用，不只检查根目录的空配置。

## 制作范围与审核

- 制作流程产出导演分析、服化道参考提示词与 Seedance 动态提示词，不会自动生成图片或视频。
- 文本和图片模型的连接测试会发出真实生成请求，可能产生费用；视频配置仅供记录，没有视频生产链或连接测试。
- 审核必须包含明确结论及合法评分。缺失、矛盾或无法解析的结果为 `INVALID`，不能推进流程。
- 审核绑定正文与上游输入的内容 hash。修改原稿或相关产物会使下游审核失效；历史未绑定的 PASS 需要重新审核。
- 导出只包含当前审核有效的产物；CSV 进行字段转义与公式文本化。导出不是完整项目备份。

## 暂停、恢复与编辑保护

- 批量任务由主进程持有，离开页面不结束任务；运行期间可从批量页控制暂停、继续或停止。
- 暂停在执行检查点等待；停止会取消网络并等待旧任务结算，不能在停止中启动新任务。重启后被打断的批队列需要显式恢复。
- 切换项目立即清空旧集数列表；项目与集数按同一加载版本发布，迟到的查询或同步结果不会覆盖新项目。
- 原稿不会因为切换文件而自动保存。编辑器以文件路径保存本地草稿，重新打开时可恢复或丢弃；磁盘内容冲突须明确选择。
- 本地存储失败会显示警告。关闭时的确认不能保证草稿已持久化；重要修改应先保存到文件。
- 文件写入采用同目录临时文件与原子替换，并保留有效的 `.bak`；状态主文件损坏时尝试备份，主副本均损坏则报错，不默默重置。

## 数据管理

设置中的数据管理提供：

- **备份/恢复项目**：保存项目文件、空目录及 SHA-256 清单；恢复到新目录并注册，拒绝符号链接和完整性校验失败的文件，不覆盖原项目。
- **备份/恢复数据库**：保存项目索引、历史及本机加密凭据，不包含项目正文。仅支持相同数据库结构；恢复前保存当前数据库副本，并以事务替换数据。跨机器后需重新输入 Key。
- **重建索引**：清理扫描/章节索引缓存后重新同步，保留计划集、稳定集 ID 与关联历史；删除产物不等于删除业务集。
- **导出诊断**：最多导出最近 2000 条事件元数据，不包含日志正文、提示词、路径或 Key。
- **清理凭据**：清除保存的 Key 与默认模型状态，保留模型配置；历史数据库备份可能仍含加密凭据。

数据管理与制作任务共用执行互斥，运行中不可同时恢复数据。请勿在备份期间从外部移动或修改项目文件。

## 项目结构

```text
src/main       Electron 主进程、IPC、数据库、工作流执行
src/preload    渲染进程安全桥接
src/renderer   React 页面、组件、hooks、stores
src/shared     主进程与渲染进程共享协议、类型和路径规则
docs           架构说明与测试矩阵
```

## 工程约束

- 合并前应保证 `lint`、`format:check`、`typecheck`、`test:coverage` 全部通过
- 新增协议或工作流阶段时，优先修改 `src/shared`
- 涉及 IPC、状态机、路径权限时，必须补对应测试

## 文档入口

- 架构与路线图：`docs/feicai-studio-architecture-and-roadmap.md`
- 测试分层说明：`docs/testing-matrix.md`

## 安全说明

- 渲染进程通过 preload 暴露显式 API，不直接访问 Node.js 能力
- IPC 仅接受本应用主框架；项目身份、参数与最终路径都需授权，拒绝项目内有效或悬空符号链接。
- LLM API Key 使用 Electron `safeStorage` 加密存储，绑定 provider、origin 与 URL 路径；修改端点后必须重新输入 Key。
- 非本机 loopback 模型地址必须使用 HTTPS；请求不跟随重定向，错误不回显服务端正文或凭据。

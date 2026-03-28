# FEICAI Studio 状态源约定

## 目标

统一 FEICAI Studio 的状态归属，避免同一份信息同时散落在 SQLite、`project-config.json` 和业务产物文件里，互相回写后产生漂移。

## 状态归属

### 1. `project-config.json`

只保存用户可编辑、需要随项目目录一起迁移的静态配置：

- 项目基础信息：`projectName`、`sourceType`、`phase`
- 创作设定：`visualStyle`、`targetMedium`
- 小说元信息：`novelTitle`、`novelGenre`
- 项目默认参数：`pipelineSettings`、`adaptSettings`、`reviewPolicy`、`flowConfig`
- 初始规划值：`totalEpisodes`

不保存运行中或扫描得出的派生状态，例如：

- 当前真实已生成多少集
- 某集是否完成导演 / 美术 / 分镜
- 解析提示词得到的时长、条数
- 当前任务执行状态

### 2. SQLite

保存应用索引和运行态摘要：

- 项目列表、当前阶段、有效集数
- episode 级状态和产物路径
- 审核记录、日志、LLM 配置

SQLite 可以从文件系统刷新派生信息，但不再把这类派生信息回写到 `project-config.json`。

### 3. 项目目录业务产物

保存真正的创作内容：

- `novel/`
- `plot-breakdown.md`
- `script/epXXX.md`
- `outputs/epXXX/*`
- `assets/*`
- `outputs/pipeline-state.json` 作为项目级运行快照与审核历史持久化文件

这些文件是内容真相来源。SQLite 只做索引，配置文件只做静态配置；`pipeline-state.json` 属于运行态快照，不承载项目静态配置。

## 当前落地规则

第一阶段先落实两条硬规则：

1. 扫描文件系统得到的 `totalEpisodes`、episode 状态等，只更新 SQLite，不再回写 `project-config.json`。
2. 所有 `project-config.json` 的读取和保存，统一走 `project-config-store`，避免多处各自 `JSON.parse` / `JSON.stringify`。

## 后续演进

后续建议继续推进：

- 将 episode 派生状态统一抽成 `episode projection` 刷新逻辑
- 将流水线运行态从全局单例访问升级为显式的 run/session registry 与队列模型
- 为项目格式增加版本与迁移器

## 当前补充实现：项目格式迁移与兼容层

目前项目级 JSON 文件已经统一纳入迁移框架：

- `project-config.json`
- `adapt-plan.json`
- `outputs/pipeline-state.json`
- `outputs/artifacts/manifest.json`

运行规则：

1. 应用启动后会对数据库中已登记项目执行一次数据预检。
2. 新接入项目在创建记录后也会立即执行一次预检。
3. 关键读取路径会在读文件前自动做兼容规范化，避免旧项目直接读炸。

迁移产物位置：

- 最近一次报告：`outputs/system/migration-reports/project-data-latest.json`
- 有实际迁移或错误时的归档报告：`outputs/system/migration-reports/project-data-<timestamp>.json`
- 原文件备份：`outputs/system/migration-backups/<timestamp>/...`

当前策略以“保守规范化”为主：

- 旧字段或运行态噪音会被剔除
- 缺失的 `version` 会自动补齐
- 旧版单卷 `adapt-plan.json` 会自动提升为多卷结构
- `pipeline-state.json` 和 artifact manifest 会按当前 schema 归一化

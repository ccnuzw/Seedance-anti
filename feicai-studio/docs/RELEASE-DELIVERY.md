# 交付验证与打包

这份文档定义桌面端交付前的最小验证路径。

## 推荐顺序

1. `npm run verify`
2. `npm run qa:batch`
3. `npm run smoke:release`
4. `npm run pack:verify`

## `smoke:release` 覆盖范围

- `out/main` / `out/preload` / `out/renderer` 产物是否齐全
- `index.html` 引用的 renderer 资源是否真实存在
- `resources/builtin-skills` 是否包含可随包分发的技能文件
- `electron-builder.yml` 是否覆盖 `package.json` 与 `node_modules/**/*`
- 主进程 bundle 的运行时外部依赖扫描
- 前端资源体积预算预警
- `better-sqlite3` 原生绑定可用性预警

## 发布资产

- 图标源文件维护在 `resources/release-assets/app-icon.svg`
- `npm run assets:icons` 会生成 `resources/release-assets/generated/icon.icns` 和 `icon.png`
- `npm run assets:monaco` 会把 `monaco-editor/min/vs` 同步到 `public/vendor/monaco/vs`
- `pack`、`dist`、`pack:verify` 现在都会先生成图标，再进入后续打包链路

## 签名与公证

- `electron-builder.yml` 已接入 `afterSign: scripts/notarize.mjs`
- 本地无凭证时会自动跳过，不阻塞普通打包
- 支持两套 notarization 凭证：
- `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`
- `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`
- 可通过 `CSC_NAME` 指定签名证书名
- 如需显式跳过，可设置 `FEICAI_SKIP_NOTARIZE=1`

## 前端体积治理约束

- `assets/index-*.js` 预算：`3 MB`
- `assets/index-*.css` 预算：`512 KB`
- `assets/*worker-*.js` 预算：`2 MB`
- 超出预算不会阻塞 `smoke:release`，但会作为显式 warning 输出，避免首屏体积和编辑器 worker 失控

当前实现已经把重页面改成路由懒加载，并把脚本编辑器收敛成 Markdown 专用 Monaco 子包，避免把大量 TS / HTML / CSS 语言服务打进首屏资源。

## 产物版本与交付闭环

- 项目当前会在 `outputs/artifacts/manifest.json` 维护统一产物清单。
- 已纳入 manifest 的关键产物包括：`plot-breakdown.md`、`adapt-plan.json`、`context-notes.md`、`script/ep*.md`、`outputs/ep*/01-director-analysis.md`、`outputs/ep*/01.5-art-design-output.md`、`outputs/ep*/02-seedance-prompts.md`、`assets/*.md`、`outputs/pipeline-state.json`。
- 每次保存、阶段产出、回滚都会生成新的版本记录，并保留快照到 `outputs/artifacts/snapshots/`。
- `ReviewPage` 现在可查看版本历史，并把某个历史版本回滚为新的当前版本。

## 交付导出内容

- `EXPORT_ALL` 现在导出的是“当前交付包”，不是简单文件夹拷贝。
- 交付包会包含：
- 当前版本产物文件
- `outputs/artifacts/manifest.json`
- `outputs/pipeline-state.json`（作为审核记录和运行来源快照）
- `export-summary.json`

## 模板复用层

- 项目设置页现在提供三类内置模板能力：`项目预设`、`任务模板库`、`导出模板`。
- `项目预设` 用于一次性覆盖 `pipelineSettings`、`reviewPolicy`、`taskDefaults`，并可指定默认导出模板。
- `任务模板库` 属于全局内置能力，批量执行页和自动化计划可直接引用，无需先复制到项目。
- 如果需要改参数，可把内置任务模板复制为项目模板；保存配置时只会持久化项目自有模板，不会把内置模板写入 `project-config.json`。
- `taskSchedules[].templateId` 现在允许直接引用内置模板 ID，因此调度配置可以稳定复用全局模板。
- 导出弹窗会默认读取 `project-config.json` 内的 `exportProfileId`，减少交付阶段的重复切换。

## 原生依赖治理命令

1. `npm run native:status`
2. `npm run native:rebuild:node`
3. `npm run native:rebuild:electron`

- `native:status` 会输出 Node / Electron ABI、`better-sqlite3` 当前绑定文件，以及是否需要 Electron 侧重建。
- `native:rebuild:node` 用工作区内的缓存目录重建当前 Node 运行时可用的 `better-sqlite3`。
- `native:rebuild:electron` 会优先复用本地 ABI 缓存；若缓存缺失，再用 `electron-rebuild` 重建 Electron 目标 ABI 所需的原生依赖。

## 项目数据迁移预检

- 启动主进程后会对已登记项目执行一次项目数据预检，覆盖 `project-config.json`、`adapt-plan.json`、`outputs/pipeline-state.json`、`outputs/artifacts/manifest.json`
- 新项目接入后也会立即执行同样的预检，避免旧格式文件进入后续流程
- 迁移报告输出到 `outputs/system/migration-reports/`
- 原文件备份输出到 `outputs/system/migration-backups/`

## `pack:verify`

- 先执行 `smoke:release`
- 再执行 `electron-builder --dir`
- 最后生成 `dist/pack-verify-report.json` 与 `dist/pack-verify-report.md`
- 打包命令会把 `npm` 缓存和 `electron-gyp` 目录落在工作区内，避免依赖 `~/.electron-gyp`
- 命令结束后会自动执行一次 `native:rebuild:node`，把工作区的 `better-sqlite3` 还原为当前 Node 可用状态，避免后续本地测试环境被污染
- 用于确认目录包可以被成功生成

目录包验收会额外检查：

- 是否存在可执行应用目录（如 `mac/*.app`、`win-unpacked/`、`linux-unpacked/`）
- 包内是否包含 `app.asar`
- `resources/builtin-skills` 是否已随包分发
- `app.asar.unpacked/node_modules/better-sqlite3/**/*.node` 是否存在

## `dist`

- `npm run dist` 现在走 `scripts/dist-release-workflow.mjs`
- 流程包含：图标生成、Monaco 静态资源同步、构建、release preflight、正式打包、交付归档、恢复 Node 原生绑定
- 打包完成后会在 `dist/release-archive/<timestamp>/` 下生成归档目录
- 归档会包含：
- `release-preflight-report.json`
- `builder-debug.yml`
- 正式产物校验信息
- `release-archive-manifest.json`
- `SHA256SUMS.txt`

## 当前已知风险

- 如果本机 `better-sqlite3` 已能在当前 Node 下加载，但 Node ABI 与 Electron ABI 不一致，`smoke:release` 仍会给出 warning，并要求执行 `npm run native:rebuild:electron`。
- 这类 warning 不阻塞 release preflight，但会影响真实打包后应用启动稳定性，正式出包前必须修复。
- 如果 Electron 原生头文件未缓存，`pack:verify` 仍可能因为网络受限或 Python / setuptools 环境不完整而失败。

## 应用内交付闭环

当前桌面端已经补充两类应用内产品化能力：

- 启动层：
  - 主进程启用单实例锁，避免重复启动造成数据库和任务状态混乱
  - `unhandledRejection` / `uncaughtException` / renderer `did-fail-load` / `render-process-gone` 都会写入 `userData/logs/app-runtime.log`
- 应用层：
  - 仪表盘新增“交付就绪面板”，直接显示 LLM 配置、项目数、死信任务、队列任务、运行日志路径、诊断导出路径
  - 设置页“关于”区域补充版本、环境、数据库路径、运行日志路径、交付评分
  - 可通过应用内按钮导出 `userData/reports/delivery-status-*.json`

建议在正式交付前人工确认：

1. 仪表盘“交付就绪面板”没有 `error` 级问题
2. 设置页中的数据库路径、运行日志路径可定位
3. 导出的 `delivery-status-*.json` 可以作为交付归档的一部分保存

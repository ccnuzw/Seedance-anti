# 运行操作验收：设置保存与任务控制

2026-11-12 在 macOS arm64 完成。本轮基于 master `290024824b375038f28276f703844571efe6394c`，加本提交的三项最小修复；应用版本 `0.1.0`。生产 main/preload/IPC/原生 SQLite 两阶段验收共 **18 组检查**通过，服务回归共 **23 suites / 279 tests** 通过，production build、强制 typecheck、lint、变更格式和 diff check 全部通过。没有调用模型或产生费用。

复跑入口（仓库根）：

```bash
python3 feicai-studio/scripts/runtime-operation-acceptance.py run_checks
```

脚本使用 `/Users/apple/Tools/node/node-v23.9.0-darwin-arm64/bin/node`（Node 23.9.0），自动发现现有 worktree 依赖，也可通过 `RUNTIME_SHARED_NODE_MODULES` 指定。运行该入口的 worktree 不应预先存在 node_modules；在独立 checkout 运行即可。脚本创建本地依赖链接，复制 better-sqlite3，串行执行所有检查后移除自建依赖目录并恢复两份 tsbuildinfo。没有安装、下载或重建 native 驱动，共享 native 文件 SHA-256 保持一致。检查入口支持在 `run_checks` 后指定检查名作局部诊断；省略时才执行完整验收。

实际 Electron 为 **42.11.18 / 内嵌 Node 24.19.0 / native ABI 146**。Electron 验收的 appData、userData、sessionData、日志、崩溃目录、SQLite 和项目全部位于 `/tmp/feicai-runtime-ipc-*`，在加载生产 main 前设置。Node fetch/http/https、Electron net、外部链接及 renderer 网络默认拦截；两阶段记录的 `networkAttempts` 均为空。数据库中没有模型配置或凭据，没有读取真实 userData、真实项目和真实密钥。

| 层次                     | 实际结果                                                                                                                                                                                                                                                                                                                       | 边界                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 真实生产 IPC：设置       | sandbox preload 调用 selectDirectory/createProject/saveProjectSettings；原生 better-sqlite3 只读连接直接比较 DB 投影和配置 JSON。2 集 × 3 章改为 4 集 × 5 章，既有剧情规划三字段唯一且正确；journal 包含两文件、committed 和 projected 收据。继续保存 6→4→4 集，公开 getPlotBreakdownSummary 的 targetChapterLimit 为 30→20→20 | 原生目录选择自动返回临时路径；没有模拟 feicaiAPI、ipcMain、设置服务或数据库。设置完成后才比较一致性，不声称多文件瞬时可见性事务                        |
| 真实生产 IPC：只读及互斥 | 5 次 idle 状态读取、3 次真实 data 租约占用读取；备份 IPC 等待目录对话框时，设置保存被拒绝。项目与 journal 内容 SHA-256/mtime、DB projects/episodes/llm_configs 行、队列文件均不变；取消备份后恢复 idle                                                                                                                         | 保留真实备份租约，仅自动化原生对话框等待/取消。未完成备份，不代表备份完整性验收                                                                        |
| 真实生产 IPC：重启队列   | 生产 main 重启将离线构造的 running 队列标为 interrupted；错误 ID 不改队列；另一真实备份租约占用时正确 ID 恢复也被拒绝且不改队列；释放后正确 queueId 恢复并完成；completed 后 pause/resume/stop 的旧身份全部拒绝                                                                                                                | 队列内已完成任务为故障 fixture，不是模型生成凭据。未通过真实 provider 执行未完成批任务                                                                 |
| 真实构建 worker          | createProject 实际调用构建产物中的 project-sync worker，并得到原生 SQLite 中的 2 个 episode 投影                                                                                                                                                                                                                               | 无 worker、扫描器或 SQLite mock；证明修复后产物可运行，不只是编译通过                                                                                  |
| 服务层独立 workflow      | 受控 runner 的 runWorkflowAction 持有真实 execution lease 时，重复 getExecutionStatus 返回 owner=workflow/running，lease 和任务快照不变，完成后 idle；覆盖 paused/stopping 及并发互斥                                                                                                                                          | runner/provider/恢复等依赖受控，不是独立 workflow 的真实模型 IPC E2E；真实 IPC 本轮证明 idle 与 data 占用                                              |
| 服务层故障恢复           | 设置恢复 9 suites / 134 tests；批处理 5 / 44；规划/水位/消费 5 / 60；provenance/扫描/worker 4 / 41                                                                                                                                                                                                                             | Electron sender/dialog/provider 按各测试现有方式受控；production-integration 使用 node:sqlite 适配驱动和真实磁盘 SQL/文件，不等于原生 Electron IPC E2E |
| 工程检查                 | npm run typecheck -- --force、npm run lint、npm run build、变更文件 prettier --check、git diff --check HEAD 均通过                                                                                                                                                                                                             | 构建不代表真实模型、打包或发布验收                                                                                                                     |

本轮发现并修复了三个缺陷，均通过协调扩展后的最小范围交付：

1. `BatchQueue.resume(queueId)` 原先只允许 paused，重启 interrupted 队列的合法定向恢复被拒绝。现在先取得新全局租约，初始化后重新核对 queueId，再恢复 interrupted；另一任务占锁时不初始化或修改队列。保留 stopped 的显式 ID 拒绝及旧无参调用兼容。新增冷启动/已初始化、workflow 持锁、错误 ID、不重复已提交子步骤与 completed 后拒绝回归。
2. 扫描 worker 的 `scan → artifact-provenance → art-output-merger → production-commit-service → DB/worker launcher` 依赖链造成 production build 递归打包 worker，报 `default is not exported`。将只读引用读取原样移入 `art-reference.ts`，保留路径校验、ENOENT/坏 JSON 行为、快照语义和 merger 的兼容 re-export；写入恢复调用保留。修复后完整 build 与真实 IPC 创建项目/worker 同步通过。类型检查和单测先前通过并不能证明 production build 可用。
3. 剧情解析将范围/目标集数/章节原则同时留在结构字段与 planningLines，保存时先写新值再追加旧值，重新读取时旧值覆盖新值。现在只排除已完整识别的三种元数据行，保留自定义说明、单集规格、批次、序号与 used 状态；显式更新旧重复文本会归一化。新增真实 bootstrap 和旧重复字段的连续更新/重复保存回归，并通过真实 IPC 重读文件及公开水位确认。没有读时写盘或启动迁移。

扫描回归另将测试中删除目录符号链接的 `rmSync` 改为 `unlinkSync`，以兼容指定 Node 23；生产路径安全规则没有放宽。

完整验收证据保留于 `/tmp/feicai-runtime-acceptance-c4hav41p/`：

- `report.json`：源基线、Node 路径及每项退出码；`checks.json` 确认全部 10 个检查出口为 0、`sharedNativeUnchanged=true`、`tsbuildinfoRestored=true`。
- `settings-recovery.log`、`batch-regression.log`、`planning-regression.log`、`worker-regression.log`：上述 279 项服务测试。
- `typecheck.log`、`lint.log`、`build.log`、`format.log`、`diff.log`：工程检查。
- `electron-ipc.log`、`ipc-settings.json`、`ipc-restart.json`：10 + 8 组真实 IPC 检查及运行时版本、构建哈希、网络尝试。预期的 busy/无效身份拒绝会由 Electron 打印 `Error occurred in handler`，测试逐项断言拒绝语义，不能据此将验收视为失败。
- `ipc-fixtures.txt` 指向 `/private/tmp/feicai-runtime-ipc-b3qWFK/`，保留原生 SQLite、项目/journal、队列、两阶段 JSON 和原始日志，可供复核。

本次真实 IPC 使用的构建 SHA-256：

| 产物                    | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| out/main/index.js       | `e05b3156451ac86ea28e41ad9667a7fdda1738cd5adc2b6c922b345466466dc1` |
| out/preload/index.js    | `f8e9ed26fc471c69e7b12904911816074c2117ba48869222a9347c5260e687f8` |
| out/renderer/index.html | `b3ac4024d5811d8fc12a60116c73433cf35716ee85f235138a6088550b4e8529` |

故障证据也保留：`/tmp/feicai-runtime-acceptance-50efrujy/build.log` 是修复前 worker 构建循环；`/tmp/feicai-runtime-acceptance-4eg47vdv/electron-ipc.log` 和 `/private/tmp/feicai-runtime-ipc-MN5Ipn/project/story/plot-breakdown.md` 包含真实 IPC 保存后新旧规划字段并存的文本。该次检查也包含验收脚本最初使用错误字段名称的断言失败；重复规划缺陷随后由文件、解析逻辑及专门回归共同确认。最终成功结果以上述完整验收目录为准。

未覆盖：真实模型/供应商/密钥/费用/生成质量、图片或视频生成、未完成付费任务的真实中途暂停/停止/恢复、设置崩溃窗口的原生 Electron 进程杀死恢复、完整 UI 点击及视觉验收、其他操作系统、安装、打包、签名及发布。设置恢复故障窗口是服务层注入；独立 workflow 忙碌是服务层受控 runner，均没有扩大为真实模型操作验收。本轮没有修改 renderer、preload、Makefile 或其他 worker 的脚本。

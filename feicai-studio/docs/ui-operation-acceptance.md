# 界面操作验收

基线：`master 2900248`，FEICAI Studio 0.1.0。入口在 `feicai-studio` 下执行：

```sh
make -f scripts/ui-operation-acceptance.Makefile verify
```

复用 `/Users/apple/Progame/Seedance-anti/feicai-studio/node_modules` 与 Node v23.9.0，不安装依赖；可通过 `M1_SHARED_NODE_MODULES`、`NODE_BIN` 覆盖。五个 Electron suite 串行执行，然后运行 renderer 回归、强制 typecheck、全仓 lint、改动文件 Prettier 和 `git diff --check`。验证器备份并恢复已有 tsbuildinfo，结束清理自己创建的依赖链接。

证据默认保存到 `/tmp/feicai-ui-operation-acceptance-task-3`，可通过 `UI_DOM_ARTIFACT_DIR` 覆盖。`report.json` 汇总每条断言、命令结果和截图绝对路径，`gallery.html` 提供可点击截图库；各 suite 的 `result.json` 和命令 `.log` 可单独复核。已有四个 DOM 入口也支持 `UI_DOM_ARTIFACT_DIR`，只导出 PNG 与 JSON，不导出 Chromium 用户目录。

| 场景                                 | 验收方式                                                                       | 证据                                               |
| ------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| 项目制作矩阵                         | 空项目、三种入口、部分读取失败、刷新、跨项目运行与390px横向滚动                | `production-matrix/`                               |
| 任务跨模块、跨项目                   | 真实剧情页点击生成，经全局准入、任务栏、ProjectRouteSync 切换到 B 批量与详情页 | `operations/`                                      |
| 终态确认、新任务切换                 | 原页卸载后受控任务完成，打开抽屉确认，再从 B 剧情页启动新身份                  | `operations/`                                      |
| 暂停、继续、停止、失败与队列         | 原任务身份控制、停止结算、队列单项失败与旧事件                                 | `task-center/`                                     |
| 批量忙闲、查询失败、选集             | 独立工作流与其他项目忙碌；失败时禁用；重查后仅 EP02 发送到 startBatch          | `operations/`、`novel-production/`                 |
| 设置保存后摘要失败                   | 真实表单编辑与保存；项目头更新、成功与警告同时出现、无保存失败误报             | `operations/`                                      |
| 小说待审、下一批、已用无剧本、未知集 | 真实 Story/Source 页面与 Pipeline 主动作；第7/8批、待审优先、未知刷新门禁      | `novel-draft/`、`novel-production/`、`operations/` |
| 桌面与390px、焦点、主要操作          | 抽屉 Tab/Escape；真实主按钮聚焦、滚动后命中测试、整页横向溢出断言              | 五个截图子目录                                     |

本轮修复基础设置的项目名称、风格、媒介、总集数、每集章节数五个标签缺少输入关联的问题；修复小说草稿已通过后，制作步骤仍一律提示“等待审核”的误导文案，按库存状态改为等待下一批、集数待核对或核对既有剧本，并补真实 DOM 回归。修复旧 suite 与当前全局准入/后台状态 API 不匹配造成的验收失效，保留真实页面调用路径。

补充中断队列定向恢复验收：真实批量页将原 queue ID 传给 `resumeBatch`，跨项目任务中心的来源链接返回原项目核对；后台查询失败或队列读取失败时禁用恢复，提交未结算时禁用重复请求。已停止的未完成队列不再显示无效的恢复入口；任务中心同样不显示继续。renderer store 的暂停、继续、停止均携带已观察队列 ID，缺少身份时拒绝控制。新增 12 条 DOM 断言、3 张截图与 2 项 store 回归；不修改 main，fixture 恢复成功不代表已验证真实后端新租约。

390px 体验限制：多条底部通知可暂时遮挡页面底部操作，关闭通知后主操作可达；动画完成后通知文本与关闭按钮未横向裁切。实际关闭通知并验证后续原文主操作的命中。诊断截图 `diagnostics/transient-toast-overlay-390.png` 另存，未把此临时遮挡宣称为已消除。

本轮结果：五个 suite 全部通过，共 **171 条 DOM 断言、33 张 PNG**；renderer **37 个文件、183 项测试通过**；`tsc --build --noEmit --force`、全仓 ESLint、改动文件 Prettier、`git diff --check` 全部通过。

| Suite                          | DOM 断言 | 截图 |
| ------------------------------ | -------: | ---: |
| production-matrix              |       35 |   11 |
| task-center                    |       21 |    3 |
| novel-draft                    |       32 |    2 |
| novel-production               |       31 |    2 |
| operations（本轮真实路由场景） |       52 |   15 |

截图经实际读取复核，包括390px抽屉、批量主按钮、设置通知与下一批操作；原始断言和全部截图索引见 `/tmp/feicai-ui-operation-acceptance-task-3/report.json` 与 `gallery.html`。

边界：运行真实 React renderer、CSS、路由同步和隔离 Electron；数据读取、文件写入、任务执行均为明确受控的 `feicaiAPI` fixture。临时 Electron main 只提供截图、按键、窗口大小和结果通道；不加载生产 main/preload，不读取生产凭据或 userData，不接触真实哑妃项目，不调用模型，不访问外网。批量启动断言验证实际页面传参，fixture 不执行生产队列。

验证分工：本文的通过结论仅覆盖上述受控 DOM 和 renderer 回归。production build、真实 worker 启动与生产 IPC 由独立 runtime 任务验证；该任务报告当前基线存在 `scan → artifact-provenance → art-output-merger → production-commit-service → DB/worker launcher` 模块循环，正将只读 art reference 函数拆至 `engine/art-reference.ts`。该修复与构建、真实 worker 结果不在本分支的验收证据中。各分支合齐后，必要的 build / worker / IPC / renderer 联合验证待整合阶段执行，不以本轮 DOM 通过推定生产链路已通过。

未验证：模型生成质量、真实供应商错误、生产 IPC/数据库/文件落盘与任务调度、多窗口并发、跨应用重启历史恢复、系统文件选择器、完整辅助技术读屏。390px 为 Electron 内容视口，不等同于移动系统或触摸设备。任务中心的重启提示仅证明明确显示未知，不证明具备跨重启恢复能力。

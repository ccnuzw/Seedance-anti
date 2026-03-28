# FEICAI Studio 功能盘点与新 IA 对照

更新时间：2026-03-26

## 当前诊断

本轮主流程已经收口到：

- 工作台
- 内容准备
- 剧本创作
- 画面制作
- 交付导出

但项目级配置没有进入新的 canonical workflow，仍主要埋在旧的 `ProjectPage.tsx` 中，导致用户感知上的“功能丢失”。

## 功能矩阵

| 功能 | 当前入口 | 当前问题 | 新归属 |
| --- | --- | --- | --- |
| 项目总览 / 下一步建议 | `ProjectWorkspacePage` | 结构已稳定，但缺少项目设置入口联动 | 工作台 |
| 小说导入 / 校对 | `SourceWorkspacePage -> NovelPage` | 入口清晰 | 内容准备 |
| 拆解 / 改编规划 | `SourceWorkspacePage -> BreakdownPage` | 入口清晰 | 内容准备 |
| 剧本生成 / 当前集编辑 | `ScriptWorkspacePage -> AdaptScriptPage` | 已收口，但项目级参数未就近说明 | 剧本创作 |
| 写作问题 / 质检 | `ScriptWorkspacePage -> ReviewPage` | 入口清晰 | 剧本创作 |
| 制作流程 / 当前运行 | `ProductionWorkspacePage -> PipelinePage` | 入口清晰 | 画面制作 |
| 素材资产 | `ProductionWorkspacePage -> AssetPage` | 已降级为上下文 tab，合理 | 画面制作 |
| 提示词 | `ProductionWorkspacePage -> PromptPage` | 已降级为上下文 tab，合理 | 画面制作 |
| 制作审核 | `ProductionWorkspacePage -> ReviewPage` | 已降级为上下文 tab，合理 | 画面制作 |
| 批量任务 | `ProductionWorkspacePage -> BatchPage` | 已降级为抽屉，合理 | 画面制作 |
| 交付检查 / 阶段切换 / 导出 | `DeliveryPage` | 缺默认模板和项目参数的近邻说明 | 交付导出 |
| 流程参数 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 流程参数 |
| 质检策略 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 流程参数 |
| 项目预设 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 模板与交付默认 |
| 导出预设 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 模板与交付默认 |
| 任务默认策略 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 自动化 |
| 项目任务模板 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 自动化 |
| 自动化计划 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 自动化 |
| 自动化告警 | `ProjectPage.tsx` | 已脱离主结构，难发现 | 项目设置 / 自动化 / 交付默认 |

## 新 IA 结论

当前项目左侧导航稳定为：

1. 工作台
2. 内容准备
3. 剧本创作
4. 画面制作
5. 交付导出
6. 项目设置

其中：

- 主流程只保留“做事入口”
- 项目设置负责“项目以后怎么跑”
- 审核、日志、批量、资产、提示词继续保留在页面上下文层，不再回到主导航一级

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
- 项目文件读写受受信目录与已注册项目根目录约束
- LLM API Key 使用 Electron `safeStorage` 加密存储；历史明文数据会在读取后迁移为加密格式

export function buildDefaultSourceTemplate(projectName = '未命名项目'): string {
  return `# 小说原文 / 项目设定

> 项目：${projectName}

请在这里粘贴或整理：

1. 小说原文或改编基础文本
2. 世界观设定
3. 角色关系
4. 你希望保留的核心冲突与钩子

如果你是从剧本开始做，这个文件可以暂时留空。
`
}

export function buildDefaultStoryBeatTemplate(episodeNum = 1): string {
  const epStr = String(episodeNum).padStart(2, '0')
  return `# EP${epStr} 剧情拆解

## 本集定位

- 主线目标：
- 主视角角色：
- 情绪基调：

## 开场钩子

用 2-4 句话写本集开场如何抓人。
`
}

export function buildDefaultScriptTemplate(episodeNum = 1): string {
  const epStr = String(episodeNum).padStart(2, '0')
  return `# EP${epStr} 剧本

## 场次 1

- 场景：
- 人物：
- 内容：
`
}

export function buildDefaultCharacterPromptsTemplate(): string {
  return `# 角色素材库

## 角色名称

- 人设：
- 外观关键词：
- 服装关键词：
- 镜头适配：
`
}

export function buildDefaultScenePromptsTemplate(): string {
  return `# 场景素材库

## 场景名称

- 时间：
- 空间：
- 氛围：
- 镜头关键词：
`
}

export function buildDefaultPlotBreakdownTemplate(params: {
  projectName?: string
  projectType?: string
  totalEpisodes?: number
  chaptersPerEpisode?: number
} = {}): string {
  const projectName = params.projectName || '未命名项目'
  const projectType = params.projectType || '待确定'
  const totalEpisodes = Math.max(0, Number(params.totalEpisodes) || 0)
  const chaptersPerEpisode = Math.max(
    0,
    Number(params.chaptersPerEpisode) || 0
  )
  const maxChapterRange =
    totalEpisodes > 0 && chaptersPerEpisode > 0
      ? `第1-${totalEpisodes * chaptersPerEpisode}章`
      : '待确定'
  const distribution =
    totalEpisodes > 0 && chaptersPerEpisode > 0
      ? `${chaptersPerEpisode}章/集`
      : '待确定'

  return `# 剧情拆解

**小说名称**：《${projectName}》
**小说类型**：${projectType}

---

## 改编规划

- **范围**：${maxChapterRange}
- **目标集数**：${totalEpisodes > 0 ? `${totalEpisodes} 集` : '待确定'}
- **单集规格**：1500-2000字，3-4个剧情点，3-4个场景，9-12个Seedance段
- **章节-集数分配原则**：${distribution}，爆点单独成集
- **分段规划**：第1-10集对应第1-40章

---

## 剧情列表

### 第1批（第1-6章）

[后续批次剧情将追加到这里]

---

**格式**：【剧情n】[场景]，[角色A]对[角色B][做了什么]，[情绪钩子类型]，第X集，状态：未用/已用
`
}

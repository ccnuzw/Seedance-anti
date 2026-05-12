import { describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { normalizeProjectConfig } from '@shared/project-config'
import { summarizeProjectPlotBreakdown } from './plot-breakdown-store'

describe('plot-breakdown-store', () => {
  it('会按目标章节上限统计水位、未拆章节和超出章节', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'feicai-waterline-'))
    try {
      const sourceDir = join(projectPath, 'source', 'chapters')
      const storyDir = join(projectPath, 'story')
      mkdirSync(sourceDir, { recursive: true })
      mkdirSync(storyDir, { recursive: true })

      for (let index = 1; index <= 95; index += 1) {
        writeFileSync(
          join(
            sourceDir,
            `chapter-${String(index).padStart(3, '0')}-第${index}章.md`
          ),
          `# 第${index}章\n\n内容 ${index}`,
          'utf-8'
        )
      }

      writeFileSync(
        join(storyDir, 'plot-breakdown.md'),
        `# 剧情拆解

## 剧情列表

### 第1批（第1-6章）

【剧情1】院子，主角救人，危机反转，第1集，状态：已用
【剧情2】宁家，主角讨债，打脸爽点，第1集，状态：未用

### 第2批（第7-12章）

【剧情3】县城，主角还债，危机解除，第2集，状态：未用
`,
        'utf-8'
      )

      const summary = summarizeProjectPlotBreakdown({
        projectPath,
        config: normalizeProjectConfig({
          projectName: '测试项目',
          totalEpisodes: 30,
          visualStyle: '写实',
          targetMedium: '短剧',
          chaptersPerEpisode: 3
        })
      })

      expect(summary).toMatchObject({
        exists: true,
        totalEntries: 3,
        usedEntries: 1,
        unusedEntries: 2,
        readyEpisodeCount: 2,
        readyEpisodeNumbers: [1, 2],
        chapterStart: 1,
        chapterEnd: 12,
        targetChapterLimit: 90,
        totalSourceChapters: 95,
        unprocessedChapterCount: 78,
        overflowChapterCount: 5,
        waterlineStatus: 'low',
        nextActionMode: 'breakdown'
      })
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
    }
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { normalizeProjectConfig } from '@shared/workflow'
import { scanEpisodeFilesystem, scanProjectFilesystem } from './scan'

describe('scanProjectFilesystem', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('能按自定义目录配置扫描项目产物', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'feicai-scan-'))
    tempDirs.push(projectRoot)

    const config = normalizeProjectConfig({
      projectName: '扫描测试',
      totalEpisodes: 2,
      directories: {
        sourceDir: 'src-materials',
        storyDir: 'storylines',
        scriptDir: 'screenplays',
        outputsDir: 'deliverables',
        reviewsDir: 'qa'
      }
    })

    mkdirSync(join(projectRoot, 'src-materials'), { recursive: true })
    mkdirSync(join(projectRoot, 'storylines', 'episode-beats'), {
      recursive: true
    })
    mkdirSync(join(projectRoot, 'screenplays'), { recursive: true })
    mkdirSync(join(projectRoot, 'deliverables', 'ep01'), { recursive: true })
    mkdirSync(join(projectRoot, 'qa', 'script'), { recursive: true })

    writeFileSync(
      join(projectRoot, 'src-materials', 'novel.md'),
      '原文',
      'utf-8'
    )
    writeFileSync(
      join(projectRoot, 'storylines', 'episode-beats', 'ep01.md'),
      '### Beat 1',
      'utf-8'
    )
    writeFileSync(
      join(projectRoot, 'screenplays', 'ep01.md'),
      '## 场景1',
      'utf-8'
    )
    writeFileSync(
      join(projectRoot, 'qa', 'script', 'ep01.md'),
      [
        '# 剧本审核',
        '',
        '- 结果：PASS',
        '- 评分：8 / 10',
        `- 时间：${new Date().toISOString()}`,
        '',
        '## 综合反馈',
        '',
        '审核通过',
        '',
        '## 问题清单',
        '',
        '无',
        ''
      ].join('\n'),
      'utf-8'
    )
    writeFileSync(
      join(projectRoot, 'deliverables', 'ep01', '01-director-analysis.md'),
      '导演分析',
      'utf-8'
    )

    const result = scanProjectFilesystem(projectRoot, config, 2)

    expect(result.hasSourceNovel).toBe(true)
    expect(result.episodeNumbers).toEqual([1])
    expect(result.episodes[0]?.scriptPath).toBe(
      join(projectRoot, 'screenplays', 'ep01.md')
    )
    expect(result.episodes[0]?.storyBeatPath).toBe(
      join(projectRoot, 'storylines', 'episode-beats', 'ep01.md')
    )
    expect(result.episodes[0]?.scriptReviewPath).toBe(
      join(projectRoot, 'qa', 'script', 'ep01.md')
    )
    expect(result.episodes[0]?.directorAnalysisPath).toBe(
      join(projectRoot, 'deliverables', 'ep01', '01-director-analysis.md')
    )
    expect(result.episodes[0]?.status).toBe('director')
  })

  it('没有任何产物目录时会按 totalEpisodes 回退生成集数列表', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'feicai-scan-'))
    tempDirs.push(projectRoot)

    const config = normalizeProjectConfig({
      projectName: '空项目',
      totalEpisodes: 3
    })

    const result = scanProjectFilesystem(projectRoot, config, 3)

    expect(result.hasSourceNovel).toBe(false)
    expect(result.episodeNumbers).toEqual([1, 2, 3])
    expect(result.episodes.every((episode) => episode.status === 'idle')).toBe(
      true
    )
  })

  it('扫描单集时只在审核通过后标记 review，并统计提示词数量和时长', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'feicai-scan-'))
    tempDirs.push(projectRoot)

    const config = normalizeProjectConfig({
      projectName: '提示词统计',
      totalEpisodes: 1
    })

    mkdirSync(join(projectRoot, 'source'), { recursive: true })
    mkdirSync(join(projectRoot, 'story', 'episode-beats'), { recursive: true })
    mkdirSync(join(projectRoot, 'script'), { recursive: true })
    mkdirSync(join(projectRoot, 'reviews', 'script'), { recursive: true })
    mkdirSync(join(projectRoot, 'outputs', 'ep01'), { recursive: true })

    writeFileSync(join(projectRoot, 'source', 'novel.md'), '原文', 'utf-8')
    writeFileSync(
      join(projectRoot, 'story', 'episode-beats', 'ep01.md'),
      '剧情拆解',
      'utf-8'
    )
    writeFileSync(join(projectRoot, 'script', 'ep01.md'), '剧本内容', 'utf-8')
    writeFileSync(
      join(projectRoot, 'reviews', 'script', 'ep01.md'),
      [
        '# 剧本审核',
        '',
        '- 结果：FAIL',
        '- 评分：5 / 10',
        `- 时间：${new Date().toISOString()}`,
        '',
        '## 综合反馈',
        '',
        '需要继续修改',
        ''
      ].join('\n'),
      'utf-8'
    )
    writeFileSync(
      join(projectRoot, 'outputs', 'ep01', '02-seedance-prompts.md'),
      [
        '## 镜头一',
        '建议时长：10',
        '内容 A',
        '',
        '## 镜头二',
        '时长：12秒',
        '内容 B'
      ].join('\n'),
      'utf-8'
    )

    const result = scanEpisodeFilesystem(projectRoot, config, 1, true)

    expect(result.scriptReviewPath).toBeNull()
    expect(result.hasScriptReview).toBe(false)
    expect(result.hasSeedancePrompts).toBe(true)
    expect(result.totalPrompts).toBe(2)
    expect(result.totalDurationSeconds).toBe(22)
    expect(result.seedancePromptsPath).toBe(
      join(projectRoot, 'outputs', 'ep01', '02-seedance-prompts.md')
    )
    expect(result.status).toBe('complete')
  })
})

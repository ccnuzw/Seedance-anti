import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { normalizeProjectConfig } from '@shared/workflow'
import { scanEpisodeFilesystem, scanProjectFilesystem } from './scan'
import { dirname } from 'path'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { formatReviewMarkdown } from '@shared/review-artifacts'
import type { ReviewResult, ReviewStage } from '@shared/types'
import type { EpisodeArtifactId } from '@shared/artifact-registry'
import { captureReviewProvenance } from '../engine/artifact-provenance'

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
    expect(result.episodeNumbers).toEqual([1, 2])
    const first = result.episodes[0]!
    expect(readFileSync(first.scriptPath!, 'utf-8')).toBe('## 场景1')
    expect(readFileSync(first.storyBeatPath!, 'utf-8')).toBe('### Beat 1')
    expect(readFileSync(first.scriptReviewPath!, 'utf-8')).toContain(
      '- 结果：PASS'
    )
    expect(readFileSync(first.directorAnalysisPath!, 'utf-8')).toBe('导演分析')
    expect(result.episodes[0]?.hasScriptReview).toBe(false)
    expect(result.episodes[0]?.status).toBe('script')
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
    expect(result.hasSeedancePrompts).toBe(false)
    expect(result.totalPrompts).toBe(2)
    expect(result.totalDurationSeconds).toBe(22)
    expect(readFileSync(result.seedancePromptsPath!, 'utf-8')).toContain(
      '内容 B'
    )
    expect(result.status).toBe('script')
  })

  it('30集计划只有ep01产物时仍返回全部计划集及额外发现集', () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-planned-scan-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'script'))
    writeFileSync(join(root, 'script', 'ep01.md'), '第一集')
    writeFileSync(join(root, 'script', 'ep35.md'), '计划外导入')
    writeFileSync(join(root, 'script', 'ep0.md'), '非法集数')
    const result = scanProjectFilesystem(root, undefined, 30)
    expect(result.episodeNumbers).toEqual([
      ...Array.from({ length: 30 }, (_, i) => i + 1),
      35
    ])
    expect(result.episodes[29]).toMatchObject({
      episodeNumber: 30,
      status: 'idle'
    })
  })

  it('当前hash绑定全链通过才能complete，源文件改变使缓存审核和下游产物失效', () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-review-scan-'))
    tempDirs.push(root)
    const config = normalizeProjectConfig({
      projectName: '当前审核',
      totalEpisodes: 1
    })
    const put = (artifact: EpisodeArtifactId, content: string) => {
      const path = resolveEpisodeArtifactPath(root, artifact, 1, config)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      return path
    }
    const review = (stage: ReviewStage): ReviewResult => ({
      stage,
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 9,
      feedback: '业务及合规通过',
      issues: [],
      createdAt: new Date().toISOString(),
      ...captureReviewProvenance(root, stage, 1, config)
    })
    const script = put('script', '剧本甲')
    put('scriptReview', formatReviewMarkdown('剧审', review('script_review')))
    put('directorAnalysis', '导演分析甲')
    const director = review('director')
    put('artDesign', '服化道甲')
    const art = review('art')
    put('seedancePrompts', '## 镜头一\n时长：10秒')
    put(
      'storyboardReview',
      formatReviewMarkdown('分镜审核', review('storyboard_review'))
    )
    const statePath = resolveProjectArtifactPath(root, 'pipelineState', config)
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(
      statePath,
      JSON.stringify({
        episodes: {
          1: {
            stageStates: {
              director: { status: 'passed', lastReview: director },
              art: { status: 'passed', lastReview: art }
            }
          }
        }
      })
    )
    expect(scanEpisodeFilesystem(root, config, 1, false)).toMatchObject({
      status: 'complete',
      hasScriptReview: true,
      hasStoryboardReview: true
    })
    writeFileSync(
      statePath,
      JSON.stringify({
        episodes: {
          1: {
            stageStates: {
              director: { status: 'failed', lastReview: director },
              art: { status: 'passed', lastReview: art }
            }
          }
        }
      })
    )
    expect(scanEpisodeFilesystem(root, config, 1, false)).toMatchObject({
      status: 'director',
      hasArtDesign: false,
      hasSeedancePrompts: false,
      hasStoryboardReview: false
    })
    writeFileSync(
      statePath,
      JSON.stringify({
        episodes: {
          1: {
            stageStates: {
              director: { status: 'passed', lastReview: director },
              art: { status: 'passed', lastReview: art }
            }
          }
        }
      })
    )
    // Keep the review file untouched; validity must depend on actual input hash.
    const fixedTime = new Date('2026-01-01T00:00:00Z')
    utimesSync(script, fixedTime, fixedTime)
    writeFileSync(script, '剧本乙')
    utimesSync(script, fixedTime, fixedTime)
    expect(scanEpisodeFilesystem(root, config, 1, false)).toMatchObject({
      status: 'script',
      hasScriptReview: false,
      hasDirectorAnalysis: false,
      hasArtDesign: false,
      hasSeedancePrompts: false,
      hasStoryboardReview: false
    })
  })

  it('拒绝扫描产物目录中的外链和悬空链接', () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-link-scan-'))
    const outside = mkdtempSync(join(tmpdir(), 'feicai-outside-scan-'))
    tempDirs.push(root, outside)
    symlinkSync(outside, join(root, 'script'), 'dir')
    expect(() => scanProjectFilesystem(root, undefined, 1)).toThrow()
    rmSync(join(root, 'script'))
    mkdirSync(join(root, 'script'))
    symlinkSync(join(outside, 'missing.md'), join(root, 'script', 'ep01.md'))
    expect(() => scanProjectFilesystem(root, undefined, 1)).toThrow()
  })
})

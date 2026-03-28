import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateProjectProgress, formatProjectProgressText, runProjectCommand } from './project-progress'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-project-progress-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('project-progress.calculateProjectProgress', () => {
  it('handles project with no script or outputs as empty progress', () => {
    const projectDir = makeProjectDir()

    const progress = calculateProjectProgress(projectDir, 0)

    expect(progress.episodes).toEqual([])
    expect(progress.summary).toMatchObject({
      totalEpisodes: 0,
      completedEpisodes: 0,
      startedEpisodes: 0
    })
  })

  it('detects episodes from script files and outputs status based on artifacts', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'script'), { recursive: true })
    writeFileSync(join(projectDir, 'script', 'ep001.md'), '# EP001 script', 'utf-8')

    mkdirSync(join(projectDir, 'outputs', 'ep002'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep002', '01-director-analysis.md'), '# director', 'utf-8')

    mkdirSync(join(projectDir, 'outputs', 'ep003'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep003', '01-director-analysis.md'), '# director', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep003', '01.5-art-design-output.md'), '# art', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep003', '02-seedance-prompts.md'), '## 镜头1\n时长：5秒', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'pipeline-state.json'), JSON.stringify({
      version: 2,
      projectId: 'project-1',
      updatedAt: new Date().toISOString(),
      episodes: {
        3: {
          episodeNum: 3,
          status: 'complete',
          lastStage: 'storyboard',
          completedStages: ['director', 'art', 'storyboard'],
          reviews: [],
          totalDurationSeconds: 5,
          updatedAt: new Date().toISOString()
        }
      }
    }, null, 2), 'utf-8')

    const progress = calculateProjectProgress(projectDir, 3)

    expect(progress.summary).toMatchObject({
      totalEpisodes: 3,
      completedEpisodes: 1,
      startedEpisodes: 2
    })

    expect(progress.episodes.find((ep) => ep.episodeNumber === 1)).toMatchObject({
      status: 'idle',
      hasScript: true,
      hasDirectorAnalysis: false,
      hasArtDesign: false,
      hasSeedancePrompts: false
    })

    expect(progress.episodes.find((ep) => ep.episodeNumber === 2)).toMatchObject({
      status: 'director',
      hasDirectorAnalysis: true,
      hasArtDesign: false,
      hasSeedancePrompts: false
    })

    expect(progress.episodes.find((ep) => ep.episodeNumber === 3)).toMatchObject({
      status: 'complete',
      hasDirectorAnalysis: true,
      hasArtDesign: true,
      hasSeedancePrompts: true,
      totalPrompts: 1,
      totalDurationSeconds: 5
    })
  })

  it('keeps EP01 in idle before ~start and switches to director after 01-director-analysis lands', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'script'), { recursive: true })
    writeFileSync(join(projectDir, 'script', 'ep001.md'), '# EP001 剧本', 'utf-8')

    expect(calculateProjectProgress(projectDir, 1).episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'idle',
      hasScript: true,
      hasDirectorAnalysis: false
    })

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(
      join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'),
      '# 导演分析\n\n## 人物清单\n- 女主\n',
      'utf-8'
    )

    expect(calculateProjectProgress(projectDir, 1).episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'director',
      hasScript: true,
      hasDirectorAnalysis: true,
      directorAnalysisPath: join(projectDir, 'outputs', 'ep001', '01-director-analysis.md')
    })
  })

  it('uses artifact manifest to mark asset updates when present', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01.5-art-design-output.md'), '# art', 'utf-8')

    mkdirSync(join(projectDir, 'outputs', 'artifacts'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'artifacts', 'manifest.json'), JSON.stringify({
      version: 1,
      projectPath: projectDir,
      artifacts: [
        {
          id: 'character-art-ep1',
          kind: 'character_prompts',
          label: 'EP01 角色提示词',
          filePath: join('assets', 'character-prompts.md'),
          isCurrent: true,
          createdAt: new Date().toISOString(),
          metadata: { episodeNum: 1 }
        }
      ]
    }, null, 2), 'utf-8')

    expect(calculateProjectProgress(projectDir, 1).episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'art',
      hasArtDesign: true,
      hasAssetUpdates: true,
      assetUpdateKinds: ['character']
    })
  })

  it('falls back to comparing assets mtime when no artifact manifest is present', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01.5-art-design-output.md'), '# art', 'utf-8')

    mkdirSync(join(projectDir, 'assets'), { recursive: true })
    writeFileSync(join(projectDir, 'assets', 'character-prompts.md'), '## 角色', 'utf-8')
    writeFileSync(join(projectDir, 'assets', 'scene-prompts.md'), '## 场景', 'utf-8')

    const ep1 = calculateProjectProgress(projectDir, 1).episodes[0]

    expect(ep1.hasAssetUpdates).toBe(true)
    expect(ep1.assetUpdateKinds).toEqual(['character', 'scene'])
    expect(ep1.status).toBe('art')
  })

  it('marks EP01 as art after assets are merged for the current episode', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'), '# director', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01.5-art-design-output.md'), '# art', 'utf-8')

    mkdirSync(join(projectDir, 'outputs', 'artifacts'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'artifacts', 'manifest.json'), JSON.stringify({
      version: 1,
      projectPath: projectDir,
      artifacts: [
        {
          id: 'character-art-ep1',
          kind: 'character_prompts',
          label: 'EP01 角色提示词',
          filePath: join('assets', 'character-prompts.md'),
          isCurrent: true,
          createdAt: new Date().toISOString(),
          metadata: { episodeNum: 1 }
        },
        {
          id: 'scene-art-ep1',
          kind: 'scene_prompts',
          label: 'EP01 场景提示词',
          filePath: join('assets', 'scene-prompts.md'),
          isCurrent: true,
          createdAt: new Date().toISOString(),
          metadata: { episodeNum: 1 }
        }
      ]
    }, null, 2), 'utf-8')

    expect(calculateProjectProgress(projectDir, 1).episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'art',
      statusLabel: '服化道',
      stageState: 'completed',
      hasDirectorAnalysis: true,
      hasArtDesign: true,
      hasAssetUpdates: true,
      assetUpdateKinds: ['character', 'scene']
    })
  })

  it('shows failed review label for art stage when the latest persisted review fails', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'), '# director', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01.5-art-design-output.md'), '# art', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'pipeline-state.json'), JSON.stringify({
      version: 2,
      projectId: 'project-1',
      updatedAt: new Date().toISOString(),
      episodes: {
        1: {
          episodeNum: 1,
          status: 'art',
          lastStage: 'art',
          completedStages: ['director'],
          reviews: [
            {
              stage: 'art',
              reviewType: 'business',
              result: 'FAIL',
              passed: false,
              score: 5,
              feedback: '场景提示词缺少光线与镜头执行细节。',
              issues: [],
              createdAt: '2026-03-27T09:00:00.000Z'
            }
          ],
          totalDurationSeconds: 0,
          updatedAt: new Date().toISOString()
        }
      }
    }, null, 2), 'utf-8')

    expect(calculateProjectProgress(projectDir, 1).episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'art',
      statusLabel: '审核失败待处理',
      stageState: 'failed',
      stageStateLabel: '审核失败待处理'
    })
  })

  it('shows failed review label for storyboard stage when the latest persisted review fails', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'), '# director', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01.5-art-design-output.md'), '# art', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep001', '02-seedance-prompts.md'), '## 镜头1\n时长：5秒', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'pipeline-state.json'), JSON.stringify({
      version: 2,
      projectId: 'project-1',
      updatedAt: new Date().toISOString(),
      episodes: {
        1: {
          episodeNum: 1,
          status: 'storyboard',
          lastStage: 'storyboard',
          completedStages: ['director', 'art'],
          reviews: [
            {
              stage: 'storyboard',
              reviewType: 'business',
              result: 'FAIL',
              passed: false,
              score: 5,
              feedback: '分镜缺少本集角色资产引用，审核未通过。',
              issues: [],
              createdAt: '2026-03-27T09:20:00.000Z'
            }
          ],
          totalDurationSeconds: 0,
          updatedAt: new Date().toISOString()
        }
      }
    }, null, 2), 'utf-8')

    expect(calculateProjectProgress(projectDir, 1).episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'storyboard',
      statusLabel: '审核失败待处理',
      stageState: 'failed',
      stageStateLabel: '审核失败待处理',
      hasSeedancePrompts: true
    })
  })

  it('keeps storyboard status when prompts exist without director analysis', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '02-seedance-prompts.md'), '## 镜头1\n时长：7秒', 'utf-8')

    expect(calculateProjectProgress(projectDir, 1).episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'storyboard',
      hasDirectorAnalysis: false,
      hasSeedancePrompts: true,
      totalPrompts: 1,
      totalDurationSeconds: 7
    })
  })

  it('reports complete status and prompt summary in ~status after storyboard happy path lands', async () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'), '# director', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01.5-art-design-output.md'), '# art', 'utf-8')
    writeFileSync(
      join(projectDir, 'outputs', 'ep001', '02-seedance-prompts.md'),
      ['## 镜头1', '时长：4秒', '', '内容 A', '', '## 镜头2', '时长：6秒', '', '内容 B'].join('\n'),
      'utf-8'
    )
    writeFileSync(join(projectDir, 'outputs', 'pipeline-state.json'), JSON.stringify({
      version: 2,
      projectId: 'project-1',
      updatedAt: new Date().toISOString(),
      episodes: {
        1: {
          episodeNum: 1,
          status: 'complete',
          lastStage: 'storyboard',
          completedStages: ['director', 'art', 'storyboard'],
          reviews: [],
          totalDurationSeconds: 10,
          updatedAt: new Date().toISOString()
        }
      }
    }, null, 2), 'utf-8')

    const result = await runProjectCommand({ command: '~status', projectPath: projectDir, totalEpisodesHint: 1 })

    expect(result.progress?.episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'complete',
      hasDirectorAnalysis: true,
      hasArtDesign: true,
      hasSeedancePrompts: true,
      totalPrompts: 2,
      totalDurationSeconds: 10
    })
    expect(result.progress?.summary).toMatchObject({
      totalEpisodes: 1,
      completedEpisodes: 1,
      counts: expect.objectContaining({ complete: 1 })
    })
    expect(result.text).toContain('EP001 已完成（提示词2条，时长10秒）')
  })
})

describe('project-progress.formatProjectProgressText & runProjectCommand', () => {
  it('formats progress summary and episodes in Chinese text', () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'script'), { recursive: true })
    writeFileSync(join(projectDir, 'script', 'ep001.md'), '# EP001 script', 'utf-8')

    const text = formatProjectProgressText(calculateProjectProgress(projectDir, 1))

    expect(text).toContain('项目进度：共 1 集')
    expect(text).toContain('阶段统计：未开始')
    expect(text).toContain('分集状态：')
    expect(text).toContain('EP001')
  })

  it('runs ~status command and returns both text and structured progress', async () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'), '# director', 'utf-8')

    const result = await runProjectCommand({ command: '~status', projectPath: projectDir, totalEpisodesHint: 1 })

    expect(result.command).toBe('~status')
    expect(result.progress?.summary.totalEpisodes).toBe(1)
    expect(result.progress?.episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'director',
      hasDirectorAnalysis: true
    })
    expect(result.text).toContain('项目进度：共 1 集')
    expect(result.text).toContain('EP001 导演分析')
  })

  it('shows idle status for ~status before director output is generated', async () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'script'), { recursive: true })
    writeFileSync(join(projectDir, 'script', 'ep001.md'), '# director input', 'utf-8')

    const result = await runProjectCommand({ command: '~status', projectPath: projectDir, totalEpisodesHint: 1 })

    expect(result.progress?.episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'idle',
      hasScript: true,
      hasDirectorAnalysis: false
    })
    expect(result.text).toContain('EP001 未开始')
  })

  it('reports art-stage asset updates in ~status output after happy-path merge', async () => {
    const projectDir = makeProjectDir()

    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'), '# director', 'utf-8')
    writeFileSync(join(projectDir, 'outputs', 'ep001', '01.5-art-design-output.md'), '# art', 'utf-8')
    mkdirSync(join(projectDir, 'outputs', 'artifacts'), { recursive: true })
    writeFileSync(join(projectDir, 'outputs', 'artifacts', 'manifest.json'), JSON.stringify({
      version: 1,
      projectPath: projectDir,
      artifacts: [
        {
          id: 'character-art-ep1',
          kind: 'character_prompts',
          label: 'EP01 角色提示词',
          filePath: join('assets', 'character-prompts.md'),
          isCurrent: true,
          createdAt: new Date().toISOString(),
          metadata: { episodeNum: 1 }
        },
        {
          id: 'scene-art-ep1',
          kind: 'scene_prompts',
          label: 'EP01 场景提示词',
          filePath: join('assets', 'scene-prompts.md'),
          isCurrent: true,
          createdAt: new Date().toISOString(),
          metadata: { episodeNum: 1 }
        }
      ]
    }, null, 2), 'utf-8')

    const result = await runProjectCommand({ command: '~status', projectPath: projectDir, totalEpisodesHint: 1 })

    expect(result.progress?.episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'art',
      hasAssetUpdates: true,
      assetUpdateKinds: ['character', 'scene']
    })
    expect(result.text).toContain('EP001 服化道')
    expect(result.text).toContain('assets新增:character+scene')
  })

  it('accepts ~design command shape and currently requires initialized project registry', async () => {
    const projectDir = makeProjectDir()

    await expect(runProjectCommand({ command: '~design ep01', projectPath: projectDir })).rejects.toThrowError(
      /数据库未初始化|当前项目未注册/
    )
  })

  it('rejects unsupported project commands', async () => {
    const projectDir = makeProjectDir()

    await expect(runProjectCommand({ command: '~start', projectPath: projectDir })).rejects.toThrowError(
      /unsupported project command/
    )
  })
})

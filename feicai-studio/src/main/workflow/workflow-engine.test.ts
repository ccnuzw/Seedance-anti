import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadSkill = vi.fn()
const reviewContent = vi.fn()
const setReviewProvider = vi.fn()
const readFile = vi.fn()
const writeFile = vi.fn()
const mkdir = vi.fn()
const parseAndMerge = vi.fn()
const listSourceChapters = vi.fn()
const appendGeneratedStoryToProjectPlotBreakdown = vi.fn()
const getProjectPlotBreakdownMarkdownForEpisode = vi.fn()
const markProjectPlotBreakdownEpisodeStatus = vi.fn()

vi.mock('fs/promises', () => ({
  readFile,
  writeFile,
  mkdir
}))

vi.mock('../engine/skill-loader', () => ({
  SkillLoader: class MockSkillLoader {
    load = loadSkill
  }
}))

vi.mock('../engine/review-engine', () => ({
  ReviewEngine: class MockReviewEngine {
    setProvider = setReviewProvider
    reviewContent = reviewContent
  }
}))

vi.mock('../engine/art-output-merger', () => ({
  ArtOutputMerger: {
    parseAndMerge
  }
}))

vi.mock('../project/novel-importer', () => ({
  listSourceChapters
}))

vi.mock('../project/plot-breakdown-store', () => ({
  appendGeneratedStoryToProjectPlotBreakdown,
  getProjectPlotBreakdownMarkdownForEpisode,
  markProjectPlotBreakdownEpisodeStatus
}))

describe('workflow-engine', async () => {
  const { WorkflowEngine } = await import('./workflow-engine')

  beforeEach(() => {
    vi.clearAllMocks()
    listSourceChapters.mockReturnValue([])
    getProjectPlotBreakdownMarkdownForEpisode.mockReturnValue(undefined)
    appendGeneratedStoryToProjectPlotBreakdown.mockReturnValue({
      path: '/tmp/project/story/plot-breakdown.md',
      appendedEntries: 0
    })
  })

  it('reviewStage(script_review) 会按 projectConfig 解析路径并落盘审核结果', async () => {
    getProjectPlotBreakdownMarkdownForEpisode.mockReturnValue(
      '# 当前集剧情点\n\n【剧情1】院子，主角救人，危机反转，第2集，状态：未用\n'
    )
    const validScript = [
      '※ 场景1 院子 日',
      'Seedance P01',
      'Seedance P02',
      'Seedance P03',
      'Seedance P04',
      'Seedance P05',
      'Seedance P06',
      'Seedance P07',
      'Seedance P08',
      'Seedance P09',
      ...Array.from({ length: 25 }, (_item, index) => `△ 动作${index + 1}，推进冲突。`),
      '※ 场景2 宁家 日',
      '※ 场景3 县城 夜',
      ...Array.from({ length: 15 }, (_item, index) => `陆青青：第${index + 1}句短对白。`),
      '【卡黑】'
    ].join('\n')
    readFile
      .mockResolvedValueOnce(validScript)
      .mockResolvedValueOnce('# story beat')
      .mockRejectedValueOnce(new Error('missing source'))
      .mockResolvedValueOnce('# EP01 previous script')
    reviewContent.mockResolvedValue({
      stage: 'script_review',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 8,
      feedback: '通过',
      issues: [],
      createdAt: '2026-05-07T00:00:00.000Z'
    })

    const engine = new WorkflowEngine('/tmp/skills')
    const provider = { generate: vi.fn(), generateStream: vi.fn() }
    engine.setProvider(provider as never)

    const result = await engine.reviewStage('script_review', {
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectConfig: {
        directories: {
          scriptDir: 'screenplays',
          reviewsDir: 'qa'
        }
      }
    })

    expect(readFile).toHaveBeenCalledWith(
      '/tmp/project/screenplays/ep02.md',
      'utf-8'
    )
    expect(reviewContent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'script_review',
        reviewSkillName: 'script-review-skill',
        outputToReview: validScript,
        originalScript: expect.stringContaining('# story beat'),
        plotBreakdown: expect.stringContaining('【剧情1】院子，主角救人')
      })
    )
    expect(reviewContent.mock.calls[0][0].originalScript).toContain(
      '# EP01 previous script'
    )
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/project/qa/script/ep02.md',
      expect.stringContaining('剧本审核'),
      'utf-8'
    )
    expect(mkdir).toHaveBeenCalledWith('/tmp/project/qa/script', {
      recursive: true
    })
    expect(result.outputPath).toBe('/tmp/project/qa/script/ep02.md')
  })

  it('reviewStage(story_review) 会审核当前批次新增剧情点，PASS 后才写入剧情库存', async () => {
    readFile
      .mockResolvedValueOnce(
        '# story beat\n\n【剧情1】院子，主角救人，危机反转，第1集，状态：未用\n'
      )
      .mockResolvedValueOnce('# source novel')
    reviewContent.mockResolvedValue({
      stage: 'story_review',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 8,
      feedback: '通过',
      issues: [],
      createdAt: '2026-05-07T00:00:00.000Z'
    })

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    const result = await engine.reviewStage('story_review', {
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectConfig: {
        directories: {
          storyDir: 'beats',
          sourceDir: 'src',
          reviewsDir: 'qa'
        }
      }
    })

    expect(readFile).toHaveBeenNthCalledWith(
      1,
      '/tmp/project/beats/episode-beats/ep01.md',
      'utf-8'
    )
    expect(readFile).toHaveBeenNthCalledWith(
      2,
      '/tmp/project/src/novel.md',
      'utf-8'
    )
    expect(reviewContent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'story_review',
        reviewSkillName: 'story-breakdown-review-skill',
        outputToReview: expect.stringContaining('# story beat'),
        originalScript: expect.stringContaining('# source novel'),
        plotBreakdown: expect.stringContaining('【剧情1】院子，主角救人')
      })
    )
    expect(reviewContent.mock.calls[0][0].plotBreakdown).toContain(
      '# 当前批次新增剧情点'
    )
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/project/qa/story/ep01.md',
      expect.stringContaining('剧情拆解审核'),
      'utf-8'
    )
    expect(appendGeneratedStoryToProjectPlotBreakdown).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      config: {
        directories: {
          storyDir: 'beats',
          sourceDir: 'src',
          reviewsDir: 'qa'
        }
      },
      generatedContent:
        '# story beat\n\n【剧情1】院子，主角救人，危机反转，第1集，状态：未用\n',
      episodeNum: 1,
      chaptersPerEpisode: 6
    })
    expect(result.outputPath).toBe('/tmp/project/qa/story/ep01.md')
  })

  it('reviewStage(story_review) 审核失败不会写入剧情库存', async () => {
    readFile
      .mockResolvedValueOnce(
        '# story beat\n\n【剧情1】院子，主角救人，危机反转，第1集，状态：未用\n'
      )
      .mockResolvedValueOnce('# source novel')
    reviewContent.mockResolvedValue({
      stage: 'story_review',
      reviewType: 'business',
      result: 'FAIL',
      passed: false,
      score: 5,
      feedback: '冲突不足',
      issues: ['冲突不足'],
      createdAt: '2026-05-07T00:00:00.000Z'
    })

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    await engine.reviewStage('story_review', {
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectConfig: {
        directories: {
          storyDir: 'beats',
          sourceDir: 'src',
          reviewsDir: 'qa'
        }
      }
    })

    expect(appendGeneratedStoryToProjectPlotBreakdown).not.toHaveBeenCalled()
  })

  it('reviewStage(storyboard_review) 会读取自定义 prompts/script/director 路径', async () => {
    readFile
      .mockResolvedValueOnce('# prompts')
      .mockResolvedValueOnce('# script')
      .mockResolvedValueOnce('# director')
    reviewContent.mockResolvedValue({
      stage: 'storyboard_review',
      reviewType: 'business',
      result: 'FAIL',
      passed: false,
      score: 6,
      feedback: '需要修改',
      issues: [],
      createdAt: '2026-05-07T00:00:00.000Z'
    })

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    await engine.reviewStage('storyboard_review', {
      projectPath: '/tmp/project',
      episodeNum: 4,
      projectConfig: {
        directories: {
          scriptDir: 'screenplays',
          outputsDir: 'deliverables',
          reviewsDir: 'qa'
        }
      }
    })

    expect(readFile).toHaveBeenNthCalledWith(
      1,
      '/tmp/project/deliverables/ep04/02-seedance-prompts.md',
      'utf-8'
    )
    expect(readFile).toHaveBeenNthCalledWith(
      2,
      '/tmp/project/screenplays/ep04.md',
      'utf-8'
    )
    expect(readFile).toHaveBeenNthCalledWith(
      3,
      '/tmp/project/deliverables/ep04/01-director-analysis.md',
      'utf-8'
    )
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/project/qa/storyboard/ep04.md',
      expect.stringContaining('分镜审核'),
      'utf-8'
    )
  })

  it('generateStage 会在缺少上游输入时抛出明确前置条件错误', async () => {
    loadSkill.mockResolvedValue({
      systemPrompt: 'skill',
      methodology: '',
      examples: {},
      guides: {},
      templates: {}
    })
    readFile.mockRejectedValue(new Error('missing'))

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    await expect(
      engine.generateStage('script', {
        projectPath: '/tmp/project',
        episodeNum: 1,
        projectContext: {
          projectName: '项目',
          visualStyle: '现实',
          targetMedium: '短剧',
          episodeNumber: 1
        },
        projectConfig: {
          directories: {
            storyDir: 'beats'
          }
        }
      })
    ).rejects.toThrow('缺少当前集未用剧情点，请先完成剧情库存拆解')
  })

  it('generateStage(story) 按旧版 6 章批次读取小说章节', async () => {
    loadSkill.mockResolvedValue({
      systemPrompt: 'story skill',
      methodology: '',
      examples: {},
      guides: {},
      templates: {}
    })
    listSourceChapters.mockReturnValue([
      {
        index: 1,
        title: '第1章',
        fileName: 'chapter-001.md',
        filePath: '/tmp/project/source/chapters/chapter-001.md'
      },
      {
        index: 2,
        title: '第2章',
        fileName: 'chapter-002.md',
        filePath: '/tmp/project/source/chapters/chapter-002.md'
      },
      {
        index: 7,
        title: '第7章',
        fileName: 'chapter-007.md',
        filePath: '/tmp/project/source/chapters/chapter-007.md'
      },
      {
        index: 8,
        title: '第8章',
        fileName: 'chapter-008.md',
        filePath: '/tmp/project/source/chapters/chapter-008.md'
      }
    ])
    readFile
      .mockResolvedValueOnce('# 第7章\n\n第七章内容')
      .mockResolvedValueOnce('# 第8章\n\n第八章内容')
      .mockRejectedValueOnce(new Error('missing story beat'))
      .mockRejectedValueOnce(new Error('missing script'))
      .mockRejectedValueOnce(new Error('missing director'))
      .mockRejectedValueOnce(new Error('missing characters'))
      .mockRejectedValueOnce(new Error('missing scenes'))
      .mockRejectedValueOnce(new Error('missing plot breakdown'))
      .mockRejectedValue(new Error('missing'))

    const generate = vi.fn().mockResolvedValue('# EP02 剧情拆解')
    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate, generateStream: vi.fn() } as never)

    await engine.generateStage('story', {
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 2
      },
      projectConfig: {
        chaptersPerEpisode: 2
      }
    })

    expect(readFile).toHaveBeenNthCalledWith(
      1,
      '/tmp/project/source/chapters/chapter-007.md',
      'utf-8'
    )
    expect(readFile).toHaveBeenNthCalledWith(
      2,
      '/tmp/project/source/chapters/chapter-008.md',
      'utf-8'
    )
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('章节范围：7-8')
      })
    )
    expect(generate.mock.calls[0][0].user).toContain('当前批次：第2批')
    expect(generate.mock.calls[0][0].user).toContain('每批章节数：6')
    expect(generate.mock.calls[0][0].user).toContain('第七章内容')
    expect(generate.mock.calls[0][0].user).toContain('第八章内容')
    expect(generate.mock.calls[0][0].user).not.toContain('source/novel.md')
    expect(appendGeneratedStoryToProjectPlotBreakdown).not.toHaveBeenCalled()
  })

  it('generateStage(story) 会按目标集数限制小说章节处理范围', async () => {
    loadSkill.mockResolvedValue({
      systemPrompt: 'story skill',
      methodology: '',
      examples: {},
      guides: {},
      templates: {}
    })
    listSourceChapters.mockReturnValue([
      {
        index: 1,
        title: '第1章',
        fileName: 'chapter-001.md',
        filePath: '/tmp/project/source/chapters/chapter-001.md'
      },
      {
        index: 2,
        title: '第2章',
        fileName: 'chapter-002.md',
        filePath: '/tmp/project/source/chapters/chapter-002.md'
      },
      {
        index: 3,
        title: '第3章',
        fileName: 'chapter-003.md',
        filePath: '/tmp/project/source/chapters/chapter-003.md'
      }
    ])
    readFile
      .mockResolvedValueOnce('# 第1章\n\n第一章内容')
      .mockResolvedValueOnce('# 第2章\n\n第二章内容')
      .mockRejectedValue(new Error('missing'))

    const generate = vi.fn().mockResolvedValue('# EP01 剧情拆解')
    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate, generateStream: vi.fn() } as never)

    await engine.generateStage('story', {
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1,
        totalEpisodes: 1,
        chaptersPerEpisode: 2
      },
      projectConfig: {
        totalEpisodes: 1,
        chaptersPerEpisode: 2
      }
    })

    expect(readFile).toHaveBeenCalledWith(
      '/tmp/project/source/chapters/chapter-001.md',
      'utf-8'
    )
    expect(readFile).toHaveBeenCalledWith(
      '/tmp/project/source/chapters/chapter-002.md',
      'utf-8'
    )
    expect(readFile).not.toHaveBeenCalledWith(
      '/tmp/project/source/chapters/chapter-003.md',
      'utf-8'
    )
    expect(generate.mock.calls[0][0].user).toContain(
      '小说处理上限：第1-2章'
    )
    expect(generate.mock.calls[0][0].user).not.toContain('第三章内容')
  })

  it('generateStage(story) 当前批次超过目标章节范围时会阻断', async () => {
    loadSkill.mockResolvedValue({
      systemPrompt: 'story skill',
      methodology: '',
      examples: {},
      guides: {},
      templates: {}
    })
    listSourceChapters.mockReturnValue([
      {
        index: 1,
        title: '第1章',
        fileName: 'chapter-001.md',
        filePath: '/tmp/project/source/chapters/chapter-001.md'
      }
    ])
    readFile.mockRejectedValue(new Error('missing'))

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    await expect(
      engine.generateStage('story', {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectContext: {
          projectName: '项目',
          visualStyle: '现实',
          targetMedium: '短剧',
          episodeNumber: 2,
          totalEpisodes: 1,
          chaptersPerEpisode: 2
        },
        projectConfig: {
          totalEpisodes: 1,
          chaptersPerEpisode: 2
        }
      })
    ).rejects.toThrow('缺少 source/novel.md，请先补齐小说原文或项目设定')
  })

  it('generateStage(script) 在当前集没有未用剧情点时会阻断', async () => {
    loadSkill.mockResolvedValue({
      systemPrompt: 'script skill',
      methodology: '',
      examples: {},
      guides: {},
      templates: {}
    })
    getProjectPlotBreakdownMarkdownForEpisode.mockReturnValue('')
    readFile
      .mockRejectedValueOnce(new Error('missing source'))
      .mockResolvedValueOnce('# EP01 剧情拆解')
      .mockRejectedValue(new Error('missing'))

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    await expect(
      engine.generateStage('script', {
        projectPath: '/tmp/project',
        episodeNum: 1,
        projectContext: {
          projectName: '项目',
          visualStyle: '现实',
          targetMedium: '短剧',
          episodeNumber: 1
        },
        projectConfig: {
          projectName: '项目',
          totalEpisodes: 30,
          visualStyle: '现实',
          targetMedium: '短剧',
          createdAt: '2026-05-11T00:00:00.000Z'
        }
      })
    ).rejects.toThrow('缺少当前集未用剧情点，请先完成剧情库存拆解')
  })

  it('generateStage(script) 会注入当前集未用剧情点，但不会在审核前标记为已用', async () => {
    loadSkill.mockResolvedValue({
      systemPrompt: 'script skill',
      methodology: '',
      examples: {},
      guides: {},
      templates: {}
    })
    getProjectPlotBreakdownMarkdownForEpisode.mockReturnValue(
      '# 当前集未用剧情点\n\n【剧情3】院子，主角救人，危机反转，第2集，状态：未用\n'
    )
    readFile
      .mockRejectedValueOnce(new Error('missing source'))
      .mockRejectedValueOnce(new Error('missing story beat'))
      .mockResolvedValueOnce('# EP01 剧本\n\n上一集卡黑')
      .mockResolvedValueOnce('# EP03 剧本\n\n下一集开场')
      .mockRejectedValueOnce(new Error('missing script'))
      .mockRejectedValueOnce(new Error('missing director'))
      .mockRejectedValueOnce(new Error('missing characters'))
      .mockRejectedValueOnce(new Error('missing scenes'))

    const generate = vi.fn().mockResolvedValue('# EP02 剧本')
    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate, generateStream: vi.fn() } as never)

    await engine.generateStage('script', {
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 2
      },
      projectConfig: {
        projectName: '项目',
        totalEpisodes: 30,
        visualStyle: '现实',
        targetMedium: '短剧',
        createdAt: '2026-05-11T00:00:00.000Z',
        pipelineSettings: {
          scriptWordCountMin: 1,
          scriptWordCountMax: 2000
        }
      }
    })

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('# 当前集剧情库存')
      })
    )
    expect(generate.mock.calls[0][0].user).toContain('【剧情3】院子，主角救人')
    expect(generate.mock.calls[0][0].user).toContain('# 上一集剧本')
    expect(generate.mock.calls[0][0].user).toContain('上一集卡黑')
    expect(generate.mock.calls[0][0].user).toContain('# 下一集剧本')
    expect(generate.mock.calls[0][0].user).toContain('下一集开场')
    expect(markProjectPlotBreakdownEpisodeStatus).not.toHaveBeenCalled()
  })

  it('reviewStage(script_review) 通过后才把当前集剧情点标记为已用', async () => {
    getProjectPlotBreakdownMarkdownForEpisode.mockReturnValue(
      '# 当前集剧情点\n\n【剧情3】院子，主角救人，危机反转，第2集，状态：未用\n'
    )
    const validScript = [
      '※ 场景1 院子 日',
      'Seedance P01',
      'Seedance P02',
      'Seedance P03',
      'Seedance P04',
      'Seedance P05',
      'Seedance P06',
      'Seedance P07',
      'Seedance P08',
      'Seedance P09',
      ...Array.from({ length: 25 }, (_item, index) => `△ 动作${index + 1}，推进冲突。`),
      '※ 场景2 宁家 日',
      '※ 场景3 县城 夜',
      ...Array.from({ length: 15 }, (_item, index) => `陆青青：第${index + 1}句短对白。`),
      '【卡黑】'
    ].join('\n')
    readFile
      .mockResolvedValueOnce(validScript)
      .mockResolvedValueOnce('# story beat')
      .mockRejectedValueOnce(new Error('missing source'))
      .mockResolvedValueOnce('# EP01 previous script')
    reviewContent.mockResolvedValue({
      stage: 'script_review',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 8,
      feedback: '通过',
      issues: [],
      createdAt: '2026-05-07T00:00:00.000Z'
    })

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    await engine.reviewStage('script_review', {
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectConfig: {
        projectName: '项目',
        totalEpisodes: 30,
        visualStyle: '现实',
        targetMedium: '短剧',
        createdAt: '2026-05-11T00:00:00.000Z',
        pipelineSettings: {
          scriptWordCountMin: 1,
          scriptWordCountMax: 2000
        }
      }
    })

    expect(markProjectPlotBreakdownEpisodeStatus).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      config: {
        projectName: '项目',
        totalEpisodes: 30,
        visualStyle: '现实',
        targetMedium: '短剧',
        createdAt: '2026-05-11T00:00:00.000Z',
        pipelineSettings: {
          scriptWordCountMin: 1,
          scriptWordCountMax: 2000
        }
      },
      episodeNum: 2,
      fromStatus: '未用',
      toStatus: '已用'
    })
  })

  it('reviewStage(script_review) 本地硬校验失败时会强制审核失败且不标记剧情点已用', async () => {
    getProjectPlotBreakdownMarkdownForEpisode.mockReturnValue(
      '# 当前集剧情点\n\n【剧情3】院子，主角救人，危机反转，第2集，状态：未用\n'
    )
    readFile
      .mockResolvedValueOnce('※ 场景1\n陆青青：一句话。')
      .mockResolvedValueOnce('# story beat')
      .mockRejectedValueOnce(new Error('missing source'))
      .mockResolvedValueOnce('# EP01 previous script')
    reviewContent.mockResolvedValue({
      stage: 'script_review',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 9,
      feedback: '通过',
      issues: [],
      createdAt: '2026-05-07T00:00:00.000Z'
    })

    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate: vi.fn(), generateStream: vi.fn() } as never)

    const result = await engine.reviewStage('script_review', {
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectConfig: {
        projectName: '项目',
        totalEpisodes: 30,
        visualStyle: '现实',
        targetMedium: '短剧',
        createdAt: '2026-05-11T00:00:00.000Z',
        pipelineSettings: {
          scriptWordCountMin: 1,
          scriptWordCountMax: 2000
        }
      }
    })

    expect(result.review.passed).toBe(false)
    expect(result.review.result).toBe('FAIL')
    expect(result.review.feedback).toContain('本地硬校验未通过')
    expect(markProjectPlotBreakdownEpisodeStatus).not.toHaveBeenCalled()
  })

  it('generateStage(art) 会按自定义输出目录写文件并触发 art 合并', async () => {
    loadSkill.mockResolvedValue({
      systemPrompt: 'skill',
      methodology: '',
      examples: {},
      guides: {},
      templates: {}
    })
    readFile
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('# script')
      .mockResolvedValueOnce('# director')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    const generate = vi.fn().mockResolvedValue('# art output')
    const engine = new WorkflowEngine('/tmp/skills')
    engine.setProvider({ generate, generateStream: vi.fn() } as never)

    const result = await engine.generateStage('art', {
      projectPath: '/tmp/project',
      episodeNum: 5,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 5
      },
      projectConfig: {
        directories: {
          outputsDir: 'deliverables'
        }
      }
    })

    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/project/deliverables/ep05/01.5-art-design-output.md',
      '# art output',
      'utf-8'
    )
    expect(parseAndMerge).toHaveBeenCalledWith(
      '# art output',
      '/tmp/project',
      5
    )
    expect(result.outputPath).toBe(
      '/tmp/project/deliverables/ep05/01.5-art-design-output.md'
    )
  })
})

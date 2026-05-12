import { beforeEach, describe, expect, it, vi } from 'vitest'

const existsSync = vi.fn()
const readdirSync = vi.fn()
const readFileSync = vi.fn()
const statSync = vi.fn()
const parseReviewMarkdown = vi.fn()

vi.mock('fs', () => ({
  existsSync,
  readdirSync,
  readFileSync,
  statSync
}))

vi.mock('@shared/review-artifacts', () => ({
  parseReviewMarkdown
}))

vi.mock('@shared/path-resolver', () => ({
  resolveEpisodeArtifactPath: (
    projectPath: string,
    artifactId: string,
    episodeNum: number
  ) =>
    `${projectPath}/${artifactId}-ep${String(episodeNum).padStart(2, '0')}.md`,
  resolveProjectArtifactPath: (projectPath: string, artifactId: string) =>
    `${projectPath}/${artifactId}.md`,
  resolveProjectLayout: () => ({
    outputsDir: 'outputs',
    scriptDir: 'script',
    storyEpisodeBeatsDir: 'story/episode-beats'
  })
}))

describe('scan 缓存行为', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('会缓存审核解析结果，并在 mtime 未变化时复用缓存', async () => {
    existsSync.mockImplementation((filePath: string) =>
      filePath.includes('scriptReview-ep01.md')
    )
    statSync.mockReturnValue({ mtimeMs: 100 })
    readFileSync.mockReturnValue('# review')
    parseReviewMarkdown.mockReturnValue({
      stage: 'script_review',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 8,
      feedback: 'ok',
      issues: [],
      createdAt: '2026-05-08T00:00:00.000Z'
    })

    const { scanEpisodeFilesystem } = await import('./scan')

    const first = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    const second = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)

    expect(readFileSync).toHaveBeenCalledTimes(1)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(1)
    expect(first.hasScriptReview).toBe(true)
    expect(second.hasScriptReview).toBe(true)
    expect(first.scriptReviewPath).toBe('/tmp/project/scriptReview-ep01.md')
    expect(second.scriptReviewPath).toBe('/tmp/project/scriptReview-ep01.md')
  })

  it('会在审核文件 mtime 变化后重新解析', async () => {
    existsSync.mockImplementation((filePath: string) =>
      filePath.includes('scriptReview-ep01.md')
    )
    statSync
      .mockReturnValueOnce({ mtimeMs: 100 })
      .mockReturnValueOnce({ mtimeMs: 101 })
    readFileSync
      .mockReturnValueOnce('# review-v1')
      .mockReturnValueOnce('# review-v2')
    parseReviewMarkdown
      .mockReturnValueOnce({
        stage: 'script_review',
        reviewType: 'business',
        result: 'PASS',
        passed: true,
        score: 8,
        feedback: 'ok',
        issues: [],
        createdAt: '2026-05-08T00:00:00.000Z'
      })
      .mockReturnValueOnce({
        stage: 'script_review',
        reviewType: 'business',
        result: 'FAIL',
        passed: false,
        score: 5,
        feedback: 'retry',
        issues: [],
        createdAt: '2026-05-08T00:10:00.000Z'
      })

    const { scanEpisodeFilesystem } = await import('./scan')

    const first = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    const second = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)

    expect(readFileSync).toHaveBeenCalledTimes(2)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(2)
    expect(first.hasScriptReview).toBe(true)
    expect(second.hasScriptReview).toBe(false)
    expect(second.scriptReviewPath).toBe('/tmp/project/scriptReview-ep01.md')
  })

  it('会缓存提示词统计结果，并在 mtime 未变化时复用缓存', async () => {
    existsSync.mockImplementation((filePath: string) =>
      filePath.includes('seedancePrompts-ep01.md')
    )
    statSync.mockReturnValue({ mtimeMs: 200 })
    readFileSync.mockReturnValue(
      [
        '## 镜头一',
        '建议时长：10',
        '内容 A',
        '',
        '## 镜头二',
        '时长：12秒',
        '内容 B'
      ].join('\n')
    )

    const { scanEpisodeFilesystem } = await import('./scan')

    const first = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    const second = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)

    expect(readFileSync).toHaveBeenCalledTimes(1)
    expect(first.totalPrompts).toBe(2)
    expect(first.totalDurationSeconds).toBe(22)
    expect(second.totalPrompts).toBe(2)
    expect(second.totalDurationSeconds).toBe(22)
  })

  it('会在提示词文件 mtime 变化后重新统计', async () => {
    existsSync.mockImplementation((filePath: string) =>
      filePath.includes('seedancePrompts-ep01.md')
    )
    statSync
      .mockReturnValueOnce({ mtimeMs: 200 })
      .mockReturnValueOnce({ mtimeMs: 201 })
    readFileSync
      .mockReturnValueOnce(['## 镜头一', '建议时长：10', '内容 A'].join('\n'))
      .mockReturnValueOnce(
        [
          '## 镜头一',
          '建议时长：10',
          '内容 A',
          '',
          '## 镜头二',
          '建议时长：15',
          '内容 B'
        ].join('\n')
      )

    const { scanEpisodeFilesystem } = await import('./scan')

    const first = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    const second = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)

    expect(readFileSync).toHaveBeenCalledTimes(2)
    expect(first.totalPrompts).toBe(1)
    expect(first.totalDurationSeconds).toBe(10)
    expect(second.totalPrompts).toBe(2)
    expect(second.totalDurationSeconds).toBe(25)
  })
})

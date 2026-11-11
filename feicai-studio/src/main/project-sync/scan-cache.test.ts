import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateProjectScanCache, scanEpisodeFilesystem } from './scan'

const {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  parseReviewMarkdown,
  isReviewCurrent
} = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  parseReviewMarkdown: vi.fn(),
  isReviewCurrent: vi.fn()
}))
vi.mock('fs', () => ({ existsSync, readdirSync, readFileSync, statSync }))
vi.mock('@shared/review-artifacts', () => ({ parseReviewMarkdown }))
vi.mock('../engine/artifact-provenance', () => ({ isReviewCurrent }))
vi.mock('../security/access-control', () => ({
  assertPathWithinProject: (_root: string, path: string) => path,
  assertEpisodeNumber: vi.fn()
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
    vi.resetAllMocks()
    invalidateProjectScanCache()
    existsSync.mockImplementation((path: string) =>
      /(?:script|scriptReview)-ep01\.md$/.test(path)
    )
    statSync.mockReturnValue({ mtimeMs: 100, ctimeMs: 100, size: 10 })
    readFileSync.mockReturnValue('# review')
    isReviewCurrent.mockReturnValue(true)
    parseReviewMarkdown.mockReturnValue({
      stage: 'script_review',
      result: 'PASS',
      passed: true
    })
  })

  it('缓存审核解析但每次重新校验当前依赖', () => {
    const first = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    const second = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    expect(first.hasScriptReview).toBe(true)
    expect(second.hasScriptReview).toBe(true)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(1)
    expect(readFileSync).toHaveBeenCalledTimes(1)
    expect(isReviewCurrent).toHaveBeenCalledTimes(2)
    isReviewCurrent.mockReturnValue(false)
    expect(
      scanEpisodeFilesystem('/tmp/project', undefined, 1, false).hasScriptReview
    ).toBe(false)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(1)
  })

  it('审核mtime或size改变时重新解析，失败审核仍可打开但不通过', () => {
    scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    statSync.mockReturnValue({ mtimeMs: 101, ctimeMs: 101, size: 11 })
    parseReviewMarkdown.mockReturnValue({
      stage: 'script_review',
      result: 'FAIL',
      passed: false
    })
    const second = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(2)
    expect(second.hasScriptReview).toBe(false)
    expect(second.scriptReviewPath).toBe('/tmp/project/scriptReview-ep01.md')
  })

  it('缓存提示词统计，文件改变后重新读取统计', () => {
    existsSync.mockImplementation((path: string) =>
      path.includes('seedancePrompts-ep01.md')
    )
    readFileSync.mockReturnValue('## 镜头一\n建议时长：10')
    const first = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    const second = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    expect(first.totalPrompts).toBe(1)
    expect(second.totalDurationSeconds).toBe(10)
    expect(readFileSync).toHaveBeenCalledTimes(1)
    statSync.mockReturnValue({ mtimeMs: 101, ctimeMs: 101, size: 50 })
    readFileSync.mockReturnValue(
      '## 镜头一\n建议时长：10\n## 镜头二\n时长：12秒'
    )
    const third = scanEpisodeFilesystem('/tmp/project', undefined, 1, false)
    expect(readFileSync).toHaveBeenCalledTimes(2)
    expect(third.totalPrompts).toBe(2)
    expect(third.totalDurationSeconds).toBe(22)
    expect(third.status).not.toBe('complete')
  })

  it('解析缓存限容并逐出最旧条目', () => {
    for (let i = 0; i < 257; i++)
      scanEpisodeFilesystem(`/tmp/project-${i}`, undefined, 1, false)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(257)
    scanEpisodeFilesystem('/tmp/project-256', undefined, 1, false)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(257)
    scanEpisodeFilesystem('/tmp/project-0', undefined, 1, false)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(258)
  })

  it('仅使指定项目缓存失效', () => {
    scanEpisodeFilesystem('/tmp/project-a', undefined, 1, false)
    scanEpisodeFilesystem('/tmp/project-b', undefined, 1, false)
    invalidateProjectScanCache('/tmp/project-a')
    scanEpisodeFilesystem('/tmp/project-a', undefined, 1, false)
    scanEpisodeFilesystem('/tmp/project-b', undefined, 1, false)
    expect(parseReviewMarkdown).toHaveBeenCalledTimes(3)
  })
})

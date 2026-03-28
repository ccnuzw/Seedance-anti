import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { projectEpisodes } from './episode-projection'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-episode-projection-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('episode-projection', () => {
  it('projects planned episodes even when only some files exist', () => {
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'script'), { recursive: true })
    writeFileSync(join(projectDir, 'script', 'ep001.md'), '# EP001\n', 'utf-8')

    const result = projectEpisodes(projectDir, 3)

    expect(result.inferredTotalEpisodes).toBe(3)
    expect(result.episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2, 3])
    expect(result.episodes[0]?.hasScript).toBe(true)
    expect(result.episodes[1]?.hasScript).toBe(false)
  })

  it('uses adapt-plan volumes and prompt content to infer episode metadata', () => {
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'outputs', 'ep001'), { recursive: true })

    writeFileSync(
      join(projectDir, 'adapt-plan.json'),
      JSON.stringify({
        volumes: [
          { targetEpisodes: 2 },
          { targetEpisodes: 3 }
        ],
        activeVolumeIndex: 0
      }, null, 2),
      'utf-8'
    )

    writeFileSync(join(projectDir, 'outputs', 'ep001', '01-director-analysis.md'), '# director\n', 'utf-8')
    writeFileSync(
      join(projectDir, 'outputs', 'ep001', '02-seedance-prompts.md'),
      [
        '## 镜头1',
        '时长：4秒',
        '',
        '正文',
        '',
        '## 镜头2',
        '建议时长：6',
        '',
        '正文'
      ].join('\n'),
      'utf-8'
    )

    const result = projectEpisodes(projectDir, 0)

    expect(result.inferredTotalEpisodes).toBe(5)
    expect(result.episodes).toHaveLength(5)
    expect(result.episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'complete',
      totalPrompts: 2,
      totalDurationSeconds: 10,
      hasDirectorAnalysis: true,
      hasSeedancePrompts: true
    })
  })
})

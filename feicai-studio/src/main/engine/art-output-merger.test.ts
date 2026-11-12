import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { ProjectConfig } from '@shared/types'
import { ArtOutputMerger, readArtReference } from './art-output-merger'
import {
  ProductionCommitStore,
  commitHash
} from '../io/production-commit-store'
import { parseAssetMarkdown } from '../asset/markdown-parser'

let root: string
const config: Partial<ProjectConfig> = {
  directories: { assetsDir: 'custom-library' }
}
const output = (characters: string, scenes: string) =>
  `# 人物提示词\n\n${characters}\n\n# 场景道具提示词\n\n${scenes}\n`
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'art-publish-')))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ArtOutputMerger approved publishing', () => {
  it('按集保留发布前的真实参考，重试不重绑定，外部编辑重新暴露当前正文', async () => {
    const path = join(root, 'custom-library', 'character-prompts.md')
    mkdirSync(dirname(path), { recursive: true })
    const original = '# 风格参考\n\n## 林舟\n\n旧蓝衣'
    writeFileSync(path, original)
    const revised = output('## 林舟\n\n新灰衣', '## 院子\n\n白昼')
    expect(readArtReference(root, 'characterPrompts', 1, config)).toBe(original)
    await ArtOutputMerger.parseAndMerge(revised, root, 1, config)
    expect(readArtReference(root, 'characterPrompts', 1, config)).toBe(original)
    expect(
      readArtReference(root, 'characterPrompts', undefined, config)
    ).toContain('新灰衣')
    await ArtOutputMerger.parseAndMerge(revised, root, 1, config)
    expect(readArtReference(root, 'characterPrompts', 1, config)).toBe(original)
    const external = readFileSync(path, 'utf8').replace(
      '新灰衣',
      '人工修改红衣'
    )
    writeFileSync(path, external)
    expect(readArtReference(root, 'characterPrompts', 1, config)).toBe(external)
    await ArtOutputMerger.parseAndMerge(revised, root, 1, config)
    expect(readArtReference(root, 'characterPrompts', 1, config)).toBe(external)
  })

  it('两份共享文件发布中途取消可重试，快照不会把部分发布误认为外部修改', async () => {
    const revised = output('## 林舟\n\n灰衣', '## 院子\n\n白昼')
    const prepared = await ArtOutputMerger.parseAndMerge(
      revised,
      root,
      1,
      config,
      undefined,
      true
    )
    const store = new ProductionCommitStore(root, config, (point) => {
      if (point === 'installed:1') throw new Error('中途取消')
    })
    const intent = await store.intent(
      'art-interruption',
      'art:1',
      commitHash(revised),
      [1]
    )
    const record = await store.prepare(intent, prepared.writes)
    await expect(store.install(record)).rejects.toThrow('中途取消')
    expect(readArtReference(root, 'characterPrompts', 1, config)).toBe('')
    expect(readArtReference(root, 'scenePrompts', 1, config)).toBe('')
    await ArtOutputMerger.parseAndMerge(revised, root, 1, config)
    expect(readArtReference(root, 'characterPrompts', 1, config)).toBe('')
    expect(readArtReference(root, 'scenePrompts', 1, config)).toBe('')
  })

  it('同集重发替换同名素材并删除本集已撤销条目，保留其他集素材', async () => {
    const shared = '## 林舟\n\n旧外套'
    await ArtOutputMerger.parseAndMerge(
      output(`${shared}\n\n## 临时角色\n\n仅第一集出现`, '## 院子\n\n旧院子'),
      root,
      1,
      config
    )
    await ArtOutputMerger.parseAndMerge(
      output(
        '## 林舟\n\n另一集共享角色\n\n## 客人\n\n第二集客人',
        '## 码头\n\n第二集码头'
      ),
      root,
      2,
      config
    )
    const revised = output('## 林舟\n\n新外套', '## 院子\n\n新院子')
    await ArtOutputMerger.parseAndMerge(revised, root, 1, config)
    await ArtOutputMerger.parseAndMerge(revised, root, 1, config)
    const characters = parseAssetMarkdown(
      readFileSync(join(root, 'custom-library', 'character-prompts.md'), 'utf8')
    )
    expect(characters.map((asset) => asset.name)).toEqual(['林舟', '客人'])
    expect(characters[0].promptText).toContain('新外套')
    expect(characters[0].promptText).toContain('feicai-art-episodes:1,2')
    expect(characters[1].promptText).toContain('第二集客人')
    const scenes = parseAssetMarkdown(
      readFileSync(join(root, 'custom-library', 'scene-prompts.md'), 'utf8')
    )
    expect(scenes.map((asset) => asset.name)).toEqual(['院子', '码头'])
    expect(scenes[0].promptText).toContain('新院子')
    expect(existsSync(join(root, 'assets'))).toBe(false)
  })

  it('旧全局同名素材被替换而不是追加，前言和不相关条目保留', async () => {
    const path = join(root, 'custom-library', 'character-prompts.md')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      '# 素材库前言\n\n## 林舟\n\n旧描述\n\n## 历史角色\n\n未改动角色'
    )
    await ArtOutputMerger.parseAndMerge(
      output('## 林舟\n\n新描述', '## 院子\n\n白天'),
      root,
      1,
      config
    )
    const content = readFileSync(path, 'utf8')
    expect(content).toContain('# 素材库前言')
    expect(content.match(/^## 林舟$/gm)).toHaveLength(1)
    expect(content).not.toContain('旧描述')
    expect(content).toContain('未改动角色')
  })

  it('取消提交门和无效分节均不会发布任何素材', async () => {
    await expect(
      ArtOutputMerger.parseAndMerge('没有分节的文案', root, 1, config)
    ).rejects.toThrow('分节')
    await expect(
      ArtOutputMerger.parseAndMerge(
        output('## 林舟\n\n描述', '## 院子\n\n描述'),
        root,
        1,
        config,
        async () => {
          throw new Error('已取消')
        }
      )
    ).rejects.toThrow('已取消')
    expect(
      existsSync(join(root, 'custom-library', 'character-prompts.md'))
    ).toBe(false)
    expect(existsSync(join(root, 'custom-library', 'scene-prompts.md'))).toBe(
      false
    )
  })

  it('二级分类和三级角色场景标题可解析，空分节和重复稳定名拒绝', () => {
    expect(
      ArtOutputMerger.validateOutput(
        '## 人物\n\n### 林舟\n\n服装\n\n## 场景\n\n### 院子\n\n白昼'
      ).characters[0].name
    ).toBe('林舟')
    expect(() =>
      ArtOutputMerger.validateOutput(output('## 林舟\n', '## 院子\n\n白天'))
    ).toThrow()
    expect(() =>
      ArtOutputMerger.validateOutput(
        output('## 林舟\n\n甲\n\n## 林舟\n\n乙', '## 院子\n\n白天')
      )
    ).toThrow('重复')
  })

  it('标准ep新增标签不改变角色身份，宫格三级说明不误拆为独立素材', async () => {
    const scenes =
      '## ep01 场景宫格\n\n总布局\n\n### 视觉规范\n\n写实\n\n### Panel Breakdown（场景拆解）\n\n格1 院子'
    await ArtOutputMerger.parseAndMerge(
      output('## 林舟（ep01 新增）\n\n初版\n\n---\n\n## 配角\n\n不变', scenes),
      root,
      1,
      config
    )
    const revision = output(
      '## 林舟（ep02 新增）\n\n重设计',
      '## ep02 场景宫格\n\n夜晚'
    )
    await ArtOutputMerger.parseAndMerge(revision, root, 2, config)
    const charPath = join(root, 'custom-library', 'character-prompts.md')
    const first = readFileSync(charPath, 'utf8')
    await ArtOutputMerger.parseAndMerge(revision, root, 2, config)
    expect(readFileSync(charPath, 'utf8')).toBe(first)
    expect(parseAssetMarkdown(first).map((asset) => asset.name)).toEqual([
      '林舟',
      '配角'
    ])
    const assets = parseAssetMarkdown(
      readFileSync(join(root, 'custom-library', 'scene-prompts.md'), 'utf8')
    )
    expect(assets.map((asset) => asset.name)).toEqual([
      'ep01 场景宫格',
      'ep02 场景宫格'
    ])
    expect(assets[0].promptText).toContain('### 视觉规范')
  })
})

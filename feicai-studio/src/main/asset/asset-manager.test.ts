import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AssetManager } from './asset-manager'
import {
  rememberSelectedFile,
  resetAccessControl
} from '../security/access-control'
import { flushPendingWrites } from '../io/atomic-file'

const directories: string[] = []
function temporary(): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'feicai-assets-'))
  )
  directories.push(root)
  return root
}
afterEach(async () => {
  await flushPendingWrites()
  resetAccessControl()
  for (const root of directories.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('AssetManager真实文件边界', () => {
  it('遵从注册配置的script/assets/outputs目录，并以原子方式更新实际文件', async () => {
    const root = temporary()
    const manager = new AssetManager(root, {
      directories: {
        scriptDir: 'custom/scripts',
        assetsDir: 'custom/assets',
        outputsDir: 'custom/outputs'
      }
    })
    await manager.saveScript(2, '剧本正文')
    expect(await manager.loadScript(2)).toBe('剧本正文')
    expect(readFileSync(join(root, 'custom/scripts/ep02.md'), 'utf8')).toBe(
      '剧本正文'
    )
    mkdirSync(join(root, 'custom/assets'), { recursive: true })
    const characters = join(root, 'custom/assets/character-prompts.md')
    writeFileSync(characters, '## 主角\n\n旧提示词')
    expect((await manager.loadCharacters())[0].name).toBe('主角')
    expect(
      await manager.updateAssetPrompt('character', '主角', '新提示词')
    ).toEqual({ success: true })
    expect(readFileSync(characters, 'utf8')).toContain('新提示词')
    expect(readFileSync(`${characters}.bak`, 'utf8')).toContain('旧提示词')
    expect(existsSync(join(root, 'script'))).toBe(false)
  })

  it('读取自定义输出目录的真实提示词，素材引用与统计遵从模板协议', async () => {
    const root = temporary()
    const output = join(root, 'custom/outputs/ep02')
    mkdirSync(output, { recursive: true })
    writeFileSync(
      join(output, '02-seedance-prompts.md'),
      `## 素材对应表
| 引用编号 | 素材类型 | 对应素材 |
| --- | --- | --- |
| @图片1 | 人物参考 | 林薇 |
| @图片3 | 场景参考 | 天台 |
| @音频1 | 背景音乐 | 城市环境音 |

## P01 重逢 【建议时长：10s】
0-3秒：以@图片1为主角，场景参考@图片3。
3-6秒：@图片1走近栏杆。
6-10秒：定格，配乐参考@音频1。

## P02 离开
时长：6.5秒
参考@场景图2。`
    )
    const manager = new AssetManager(root, {
      directories: { outputsDir: 'custom/outputs' }
    })
    const prompts = await manager.loadPrompts(2)
    expect(prompts[0].references).toEqual([
      {
        promptIndex: 1,
        referenceTag: '@图片1',
        assetType: 'character',
        assetName: '林薇'
      },
      {
        promptIndex: 1,
        referenceTag: '@图片3',
        assetType: 'scene',
        assetName: '天台'
      }
    ])
    expect(await manager.getPromptStats(2)).toEqual({
      totalCount: 2,
      totalDuration: 16.5,
      avgDuration: 8.3
    })
  })

  it('拒绝资产文件的有效/悬空链接及script父目录链接，不伪装成空资产', async () => {
    const root = temporary()
    const outside = temporary()
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(outside, 'secret.md'), 'secret')
    symlinkSync(
      join(outside, 'secret.md'),
      join(root, 'assets/character-prompts.md')
    )
    symlinkSync(
      join(outside, 'missing.md'),
      join(root, 'assets/scene-prompts.md')
    )
    symlinkSync(outside, join(root, 'script'))
    const manager = new AssetManager(root)
    await expect(manager.loadCharacters()).rejects.toThrow('符号链接')
    await expect(manager.loadScenes()).rejects.toThrow('符号链接')
    await expect(
      manager.updateAssetPrompt('character', '主角', 'bad')
    ).rejects.toThrow('符号链接')
    await expect(manager.saveScript(1, 'bad')).rejects.toThrow('符号链接')
    expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('secret')
  })

  it('参考图复制只消费选定源文件，最终目标和目标父链接都拒绝', async () => {
    const root = temporary()
    const external = temporary()
    const source = join(external, 'hero.png')
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    writeFileSync(source, bytes)
    const manager = new AssetManager(root, {
      directories: { assetsDir: 'design-assets' }
    })
    await expect(
      manager.uploadReferenceImage('character', 'hero', source)
    ).rejects.toThrow('未授权')
    rememberSelectedFile(source)
    const destination = await manager.uploadReferenceImage(
      'character',
      'hero',
      source
    )
    expect(destination).toBe(
      join(root, 'design-assets/images/character/hero.png')
    )
    expect(readFileSync(destination)).toEqual(bytes)
    expect(await manager.listReferenceImages('character')).toEqual([
      destination
    ])
    symlinkSync(
      join(external, 'missing.png'),
      join(root, 'design-assets/images/character/link.png')
    )
    await expect(
      manager.uploadReferenceImage('character', 'link', source)
    ).rejects.toThrow('符号链接')
    await expect(manager.listReferenceImages('character')).rejects.toThrow(
      '符号链接'
    )
    mkdirSync(join(root, 'design-assets/images/scene'), { recursive: true })
    const linkedRoot = temporary()
    symlinkSync(external, join(linkedRoot, 'assets'))
    await expect(
      new AssetManager(linkedRoot).uploadReferenceImage(
        'scene',
        'scene',
        source
      )
    ).rejects.toThrow('符号链接')
    expect(existsSync(join(external, 'missing.png'))).toBe(false)
  })

  it('普通缺失资产返回空列表；非法集数或素材类型不进入I/O', async () => {
    const manager = new AssetManager(temporary())
    expect(await manager.loadCharacters()).toEqual([])
    expect(await manager.loadScenes()).toEqual([])
    expect(await manager.loadPrompts(1)).toEqual([])
    await expect(manager.loadPrompts(0)).rejects.toThrow('集数')
    await expect(
      manager.listReferenceImages('../../outside' as 'character')
    ).rejects.toThrow('素材类型')
  })
})

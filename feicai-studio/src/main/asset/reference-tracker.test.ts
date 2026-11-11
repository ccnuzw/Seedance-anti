import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeStats, parseSeedanceFile } from './reference-tracker'

const template = readFileSync(
  new URL(
    '../../../resources/builtin-skills/seedance-storyboard-skill/templates/seedance-prompts-template.md',
    import.meta.url
  ),
  'utf8'
)
const templateDocument = template
  .match(/```markdown\n([\s\S]*?)\n```/)![1]
  .replace('[根据01讲戏本填入]', '10')
  .replace('[X]', '6.5')
  .replace(
    '[人物名，参见 character-prompts.md]',
    '[林薇，参见 character-prompts.md]'
  )
  .replace(
    '[人物名，参见 character-prompts.md]',
    '[陈默，参见 character-prompts.md]'
  )
  .replace('[场景名，参见 scene-prompts.md]', '[天台，参见 scene-prompts.md]')
  .replace('[场景名，参见 scene-prompts.md]', '[办公室，参见 scene-prompts.md]')
  .replace(
    /\[完整的[\s\S]*?视频。\]/,
    '以@图片1中的林薇为主角，场景参考@图片3，配乐参考@音频1。\n0-3秒：林薇走入天台。\n3-6秒：参考@图片3，环绕拍摄@图片1。\n6-10秒：定格。'
  )
  .replace('[...]', '参考@图片2和@图片4，@视频1提供运镜参考。')

describe('Seedance reference tracker', () => {
  it('从真实内置模板的素材表解析类型和名称，从标题读取整段时长', () => {
    const prompts = parseSeedanceFile(templateDocument)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toMatchObject({ index: 1, duration: 10 })
    expect(prompts[0].content).toContain('6-10秒：定格。')
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
    expect(prompts[1].references).toEqual([
      {
        promptIndex: 2,
        referenceTag: '@图片2',
        assetType: 'character',
        assetName: '陈默'
      },
      {
        promptIndex: 2,
        referenceTag: '@图片4',
        assetType: 'scene',
        assetName: '办公室'
      }
    ])
    expect(computeStats(prompts)).toEqual({
      totalCount: 2,
      totalDuration: 16.5,
      avgDuration: 8.3
    })
  })

  it('无素材表的历史文档保留引用协议、正文时长与原始编号', () => {
    const prompts = parseSeedanceFile(
      `# 提示词 3 开场\n时长：8秒\n@图片1 @场景图2 @图片1\n\n## P09 对话\nduration: 6.5s\n@场景图2 @场景图2 @音频1 @视频1`
    )
    expect(prompts.map(({ index, duration }) => ({ index, duration }))).toEqual(
      [
        { index: 3, duration: 8 },
        { index: 9, duration: 6.5 }
      ]
    )
    expect(prompts[0].references).toEqual([
      { promptIndex: 3, referenceTag: '@图片1', assetType: 'character' },
      { promptIndex: 3, referenceTag: '@场景图2', assetType: 'scene' }
    ])
    expect(prompts[1].references).toEqual([
      { promptIndex: 9, referenceTag: '@场景图2', assetType: 'scene' }
    ])
  })

  it('只计正文实际使用的素材，未知、缺失映射和音视频不伪装成角色', () => {
    const [prompt] = parseSeedanceFile(`## 素材对应表
| 引用编号 | 素材类型 | 对应素材 |
| --- | --- | --- |
| @图片1 | 人物参考 | **林薇** |
| @图片3 | 场景参考 | [雨巷](scene-prompts.md) |
| @图片4 | 道具参考 | 手表 |
| @图片5 | 背景音乐 | 雨声 |
| @图片6 | | 不明 |
| @音频1 | 人物参考 | 旁白 |
| @视频1 | 场景参考 | 运镜 |
| @场景图2 | 场景参考 | 旧城区 |

## P01 【建议时长：10s】
@图片3 @图片3 @图片4 @图片5 @图片6 @图片99 @音频1 @视频1 @场景图2`)
    expect(prompt.references).toEqual([
      {
        promptIndex: 1,
        referenceTag: '@图片3',
        assetType: 'scene',
        assetName: '雨巷'
      },
      {
        promptIndex: 1,
        referenceTag: '@场景图2',
        assetType: 'scene',
        assetName: '旧城区'
      }
    ])
  })

  it('新格式素材表缺失类型列时不把图片猜成角色', () => {
    const [prompt] = parseSeedanceFile(`## 素材对应表
| 引用编号 | 对应素材 |
| --- | --- |
| @图片3 | 天台 |

## P01
@图片3 @音频1 @视频1`)
    expect(prompt.references).toEqual([])
  })

  it('冲突的素材表声明不猜测资产，表外的历史场景图仍可识别', () => {
    const [prompt] = parseSeedanceFile(`## 素材对应表
| 引用编号 | 素材类型 | 对应素材 |
| --- | --- | --- |
| @图片1 | 人物参考 | 林薇 |
| @图片1 | 场景参考 | 天台 |
| @图片3 | 场景参考 | 天台 |
| @图片3 | 场景参考 | 天台 |

## P01
@图片1 @图片3 @场景图7`)
    expect(prompt.references).toEqual([
      {
        promptIndex: 1,
        referenceTag: '@图片3',
        assetType: 'scene',
        assetName: '天台'
      },
      { promptIndex: 1, referenceTag: '@场景图7', assetType: 'scene' }
    ])
  })

  it.each([
    ['【建议时长：10s】', '时长：6秒', 10],
    ['【建议时长：7．5秒】', '**时长：** 6秒', 7.5],
    ['【建议时长：未定】', '**时长**：6.5秒', 6.5],
    ['【建议时长：0s】', 'duration: 4s', 4],
    ['【建议时长：-10s】', '时长：3秒', 3],
    ['【建议时长：10.2.3s】', '时长：8秒', 8],
    ['【建议时长：Infinity秒】', '时长：NaN秒', 5],
    ['', '时长：0秒\n时长：-2s', 5],
    ['', '时长：8-10秒', 5],
    ['【建议时长：8s - 10s】', '时长：6秒', 6],
    ['', `时长：${'9'.repeat(400)}秒`, 5],
    ['', '0-3秒：建立镜头\n3-6秒：中间动作\n6-10秒：收尾', 5],
    ['', '镜头包含3秒停顿，人物望向远方。', 5],
    ['', '7.5s\n连续镜头', 7.5],
    ['', '', 5]
  ])('时长优先级和非法值：%s / %s', (title, body, duration) => {
    expect(parseSeedanceFile(`## P01 开场 ${title}\n${body}`)[0].duration).toBe(
      duration
    )
  })

  it('空文件统计为零，未填写的模板不产生非法时长', () => {
    expect(computeStats(parseSeedanceFile(''))).toEqual({
      totalCount: 0,
      totalDuration: 0,
      avgDuration: 0
    })
    const prompts = parseSeedanceFile(
      template.match(/```markdown\n([\s\S]*?)\n```/)![1]
    )
    expect(prompts.map((prompt) => prompt.duration)).toEqual([5, 5])
    expect(
      prompts[0].references.every((ref) => ref.assetName === undefined)
    ).toBe(true)
  })
})
